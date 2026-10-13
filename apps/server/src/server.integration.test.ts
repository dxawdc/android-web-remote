import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { WebSocket, type WebSocketServer } from "ws";

const password = randomBytes(24).toString("hex");
const accessKey = randomBytes(24).toString("hex");
const sockets = new Set<WebSocket>();
let directory: string;
let server: Server;
let wss: WebSocketServer;
let base: string;
let adminToken: string;
let sequence = 0;
const envKeys = ["DATA_DIR", "APK_DIR", "PORT", "ADMIN_USERNAME", "ADMIN_PASSWORD", "JWT_SECRET"] as const;
const apkBytes = Buffer.from("synthetic-test-apk");
const apkRelease = { version: "0.7.0", versionCode: 7, filename: "remote-control-agent-0.7.0.apk",
  size: apkBytes.length, sha256: createHash("sha256").update(apkBytes).digest("hex") };
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

async function api(endpoint: string, method = "GET", body?: unknown, token = adminToken) {
  const response = await fetch(`${base}${endpoint}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) as any };
}

function inbox(socket: WebSocket) {
  const messages: any[] = [];
  socket.on("message", raw => messages.push(JSON.parse(raw.toString())));
  return {
    socket,
    messages,
    async next(type: string) {
      await expect.poll(() => messages.some(message => message.type === type), { timeout: 3000 }).toBe(true);
      return messages.splice(messages.findIndex(message => message.type === type), 1)[0];
    },
    send(message: unknown) { socket.send(JSON.stringify(message)); },
  };
}

async function open() {
  const socket = new WebSocket(`${base.replace("http:", "ws:")}/ws`);
  sockets.add(socket);
  socket.on("error", () => {});
  const client = inbox(socket);
  await once(socket, "open");
  return client;
}

async function fixture() {
  const suffix = ++sequence;
  const username = `review-user-${suffix}`;
  const user = (await api("/api/admin/users", "POST", { username, password })).body.user;
  const token = (await api("/api/auth/login", "POST", { username, password }, "")).body.token;
  const deviceId = `review-device-${suffix}`;
  const saved = await api("/api/devices", "POST", { name: deviceId, deviceId, accessKey }, token);
  expect(saved.status).toBe(201);
  const device = saved.body.device;
  const agent = await open();
  agent.send({ type: "registerDevice", deviceId, accessKey });
  await agent.next("registered");
  const controller = await open();
  controller.send({ type: "connectController", token, deviceDbId: device.id });
  expect((await controller.next("deviceStatus")).online).toBe(true);
  await agent.next("startStream");
  agent.messages.length = 0;
  return { user, token, device, deviceId, agent, controller };
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "remote-server-test-"));
  Object.assign(process.env, {
    DATA_DIR: directory, APK_DIR: path.join(directory, "downloads"), PORT: "0", ADMIN_USERNAME: "review-admin", ADMIN_PASSWORD: password,
    JWT_SECRET: randomBytes(32).toString("hex"),
  });
  await mkdir(path.join(directory, "downloads"));
  await writeFile(path.join(directory, "downloads", apkRelease.filename), apkBytes);
  await writeFile(path.join(directory, "downloads", "latest.json"), JSON.stringify(apkRelease));
  ({ server, wss } = await import("./index.js"));
  if (!server.listening) await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  base = `http://127.0.0.1:${address.port}`;
  adminToken = (await api("/api/auth/login", "POST", { username: "review-admin", password }, "")).body.token;
}, 15000);

afterAll(async () => {
  sockets.forEach(socket => socket.terminate());
  wss?.clients.forEach(socket => socket.terminate());
  if (wss) await new Promise<void>(resolve => wss.close(() => resolve()));
  if (server) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("WebSocket authorization and lifecycle", () => {
  it("stores authenticated device logs without broadcasting and makes them available to admins while offline", async () => {
    const f = await fixture();
    const endpoint = `/api/admin/diagnostics/${f.device.id}/logs`;
    expect((await api(endpoint, "GET", undefined, "")).status).toBe(401);
    expect((await api(endpoint, "GET", undefined, f.token)).status).toBe(403);
    expect((await api(endpoint)).body.snapshot).toBeNull();
    const upload = { type: "diagnosticLogs", uploadId: "1:99", version: "0.9.0", lines: ["[连接失败] 网络不可用", "[认证] 成功"] };
    const stranger = await open(); stranger.send(upload); await stranger.next("authFailed");
    expect((await api(endpoint)).body.snapshot).toBeNull();
    f.agent.send(upload);
    expect(await f.agent.next("diagnosticLogsAck")).toMatchObject({ success: true, uploadId: "1:99" });
    expect(f.controller.messages.some(message => message.type === "diagnosticLogs")).toBe(false);
    const closed = once(f.agent.socket, "close"); f.agent.socket.close(); await closed;
    expect((await api(endpoint)).body.snapshot).toMatchObject({ version: "0.9.0", lines: upload.lines });
    const another = await fixture();
    expect((await api(`/api/admin/diagnostics/${another.device.id}/logs`)).body.snapshot).toBeNull();
    expect((await api(`/api/devices/${f.device.id}`, "DELETE", undefined, f.token)).status).toBe(204);
    expect((await api(endpoint)).status).toBe(404);
  });

  it("rejects malformed log batches without interrupting screen streaming", async () => {
    const f = await fixture();
    f.agent.send({ type: "diagnosticLogs", uploadId: "1:1", version: "0.9.0", lines: [42] });
    expect((await f.agent.next("diagnosticLogsAck")).success).toBe(false);
    f.agent.send({ type: "screenFrame", data: "still-streaming" });
    expect((await f.controller.next("screenFrame")).data).toBe("still-streaming");
  });

  it("protects versioned APK metadata and bytes behind active-user authentication", async () => {
    expect((await api("/api/downloads/android", "GET", undefined, "")).status).toBe(401);
    expect((await api(`/api/downloads/android/${apkRelease.filename}`, "GET", undefined, "")).status).toBe(401);
    const metadata = await api("/api/downloads/android");
    expect(metadata.body).toEqual(apkRelease);
    const download = await fetch(`${base}/api/downloads/android/${apkRelease.filename}`, { headers: { Authorization: `Bearer ${adminToken}` } });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain(apkRelease.filename);
    expect(download.headers.get("cache-control")).toContain("no-store");
    expect(Buffer.from(await download.arrayBuffer())).toEqual(apkBytes);
    expect((await api("/api/downloads/android/remote-control-agent-0.1.0.apk")).status).toBe(404);
    expect((await api("/api/downloads/android/%2e%2e%2fremote-control.json")).status).toBe(404);
  });

  it("reports missing, incomplete, or invalid releases without exposing server paths", async () => {
    const manifest = path.join(directory, "downloads", "latest.json");
    for (const invalid of [{ ...apkRelease, size: 1 }, { ...apkRelease, filename: "../remote-control.json" }, null]) {
      await writeFile(manifest, JSON.stringify(invalid));
      const response = await api("/api/downloads/android");
      expect(response.status).toBe(503);
      expect(response.body.message).toBe("Android 安装包暂未发布，请稍后重试");
    }
    await rm(manifest);
    expect((await api("/api/downloads/android")).status).toBe(503);
    await writeFile(manifest, JSON.stringify(apkRelease));
  });

  it("rejects malformed JSON and non-object messages without killing the server", async () => {
    const client = await open();
    for (const raw of ["null", "[]", "1", '"text"', "{}", '{"type":1}', "{"]) {
      client.socket.send(raw);
      await client.next("error");
      expect((await api("/health")).status).toBe(200);
    }
    client.send({ type: "connectController", token: "invalid", deviceDbId: 1 });
    await client.next("authFailed");
  });

  it("handles oversized frames without an unhandled socket error", async () => {
    const client = await open();
    const closed = once(client.socket, "close");
    client.socket.send("x".repeat(4 * 1024 * 1024 + 1));
    await closed;
    expect((await api("/health")).status).toBe(200);
  });

  it("revokes active sessions and rejects new ones when an account is disabled", async () => {
    const f = await fixture();
    const other = await fixture();
    const controllerClosed = once(f.controller.socket, "close");
    const agentClosed = once(f.agent.socket, "close");
    expect((await api(`/api/admin/users/${f.user.id}`, "PATCH", { active: false })).status).toBe(200);
    expect((await controllerClosed)[0]).toBe(4003);
    expect((await agentClosed)[0]).toBe(4003);
    expect((await api("/api/devices", "GET", undefined, f.token)).status).toBe(401);
    expect((await api(`/api/downloads/android/${apkRelease.filename}`, "GET", undefined, f.token)).status).toBe(401);
    const unauthorized = await open();
    unauthorized.send({ type: "connectController", token: f.token, deviceDbId: f.device.id });
    await unauthorized.next("authFailed");
    const device = await open();
    device.send({ type: "registerDevice", deviceId: f.deviceId, accessKey });
    await device.next("authFailed");
    other.controller.send({ type: "home" });
    await other.agent.next("home");
    other.agent.send({ type: "screenFrame", data: "unaffected-device" });
    expect((await other.controller.next("screenFrame")).data).toBe("unaffected-device");
  });

  it("closes both sides on deletion and isolates the new owner's session", async () => {
    const f = await fixture();
    const controllerClosed = once(f.controller.socket, "close");
    const agentClosed = once(f.agent.socket, "close");
    expect((await api(`/api/devices/${f.device.id}`, "DELETE", undefined, f.token)).status).toBe(204);
    expect((await controllerClosed)[0]).toBe(4003);
    await agentClosed;
    const saved = await api("/api/devices", "POST", { name: "new-owner", deviceId: f.deviceId, accessKey });
    const newAgent = await open();
    newAgent.send({ type: "registerDevice", deviceId: f.deviceId, accessKey });
    await newAgent.next("registered");
    const newController = await open();
    newController.send({ type: "connectController", token: adminToken, deviceDbId: saved.body.device.id });
    await newController.next("deviceStatus");
    newAgent.send({ type: "screenFrame", data: "synthetic-test-frame" });
    expect((await newController.next("screenFrame")).data).toBe("synthetic-test-frame");
    expect(f.controller.messages.some(message => message.type === "screenFrame")).toBe(false);
    const oldOwner = await open();
    oldOwner.send({ type: "connectController", token: f.token, deviceDbId: saved.body.device.id });
    await oldOwner.next("authFailed");
  });

  it.each([false, true])("revokes deleted-owner sessions (device offline: %s)", async offline => {
    const f = await fixture();
    const agentClosed = once(f.agent.socket, "close");
    if (offline) {
      f.agent.socket.close();
      await agentClosed;
    }
    const closed = once(f.controller.socket, "close");
    expect((await api(`/api/admin/users/${f.user.id}`, "DELETE")).status).toBe(204);
    expect((await closed)[0]).toBe(4003);
    await agentClosed;
    const reconnect = await open();
    reconnect.send({ type: "connectController", token: f.token, deviceDbId: f.device.id });
    await reconnect.next("authFailed");
  });

  it("rejects invalid account fields before persisting incompatible data", async () => {
    const f = await fixture();
    for (const body of [{ role: "invalid" }, { active: "false" }, { username: [] }, { password: "x" }]) {
      expect((await api(`/api/admin/users/${f.user.id}`, "PATCH", body)).status).toBe(400);
    }
    expect((await api("/api/devices", "GET", undefined, f.token)).status).toBe(200);
    const users = (await api("/api/admin/users")).body.users;
    expect(users.find((user: any) => user.id === f.user.id)).toMatchObject({ role: "user", active: 1 });
  });

  it("keeps streaming for remaining viewers and stops for the final viewer", async () => {
    const f = await fixture();
    const second = await open();
    second.send({ type: "connectController", token: f.token, deviceDbId: f.device.id });
    await second.next("deviceStatus");
    await f.agent.next("startStream");
    f.agent.messages.length = 0;
    const closed = once(f.controller.socket, "close");
    f.controller.socket.close();
    await closed;
    second.send({ type: "home" });
    await f.agent.next("home");
    expect(f.agent.messages.some(message => message.type === "stopStream")).toBe(false);
    second.socket.close();
    await f.agent.next("stopStream");
    const diagnostics = (await api("/api/admin/diagnostics")).body.devices;
    expect(diagnostics.find((item: any) => item.id === f.device.id).session.controllerCount).toBe(0);
  });
});
