import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteDevice: vi.fn().mockResolvedValue(undefined),
  devices: vi.fn().mockResolvedValue({
    devices: [
      {
        id: 7,
        device_id: "DEVICE123",
        name: "测试手机",
        last_seen_at: null,
        created_at: "",
        updated_at: "",
        online: false,
      },
    ],
  }),
  diagnostics: vi.fn().mockResolvedValue({
    generatedAt: "2026-07-28T16:00:00.000Z",
    devices: [
      {
        id: 7,
        user_id: 2,
        device_id: "DEVICE123",
        name: "朋友的手机",
        owner_username: "friend",
        last_seen_at: "2026-07-28T15:59:59.000Z",
        session: {
          online: true,
          connectedAt: "2026-07-28T15:58:00.000Z",
          disconnectedAt: null,
          lastMessageAt: "2026-07-28T15:59:59.000Z",
          lastFrameAt: "2026-07-28T15:59:55.000Z",
          lastCaptureError: { code: -1, reason: "timeout", at: "2026-07-28T15:59:50.000Z" },
          controllerCount: 2,
        },
      },
    ],
  }),
}));

const remote = vi.hoisted(() => ({
  listener: undefined as ((message: Record<string, unknown>) => void) | undefined,
  connect: vi.fn(),
  send: vi.fn(),
}));

vi.mock("./lib/api", () => ({
  api: {
    devices: mocks.devices,
    deleteDevice: mocks.deleteDevice,
    login: vi.fn(),
    addDevice: vi.fn(),
    renameDevice: vi.fn(),
    users: vi.fn(),
    diagnostics: mocks.diagnostics,
    addUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
  },
}));

vi.mock("./lib/remoteClient", () => ({
  RemoteClient: class {
    constructor(listener: (message: Record<string, unknown>) => void) {
      remote.listener = listener;
    }
    connect(...args: unknown[]) {
      remote.connect(...args);
      remote.listener?.({ type: "deviceStatus", online: true });
    }
    send(...args: unknown[]) {
      remote.send(...args);
    }
    gesture() {}
    launch() {}
    close() {}
  },
  demoDevice: { name: "测试设备", model: "", androidVersion: "", battery: 0, apps: [] },
}));

import App from "./App";

describe("device management", () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem("remote-token", "test-token");
    sessionStorage.setItem(
      "remote-user",
      JSON.stringify({ id: 1, username: "tester", role: "user" }),
    );
    mocks.deleteDevice.mockClear();
    mocks.devices.mockClear();
    mocks.diagnostics.mockClear();
    remote.connect.mockClear();
    remote.send.mockClear();
    remote.listener = undefined;
  });

  it("deletes a saved device after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);
    const deleteButton = await screen.findByRole("button", { name: "删除设备" });
    fireEvent.click(deleteButton);
    await waitFor(() => expect(mocks.deleteDevice).toHaveBeenCalledWith("test-token", 7));
  });

  it("shows capture failures and allows manually reconnecting the screen stream", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "连接设备" }));
    expect(await screen.findByText("正在获取首帧画面")).toBeTruthy();

    act(() => {
      remote.listener?.({ type: "captureError", code: 2 });
    });

    expect(await screen.findByText("正在重新请求画面")).toBeTruthy();
    expect(screen.getByText(/错误码 2/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新请求画面" }));
    expect(remote.connect).toHaveBeenCalledTimes(1);
    expect(remote.send).toHaveBeenCalledWith("restartStream");
  });

  it("shows live device diagnostics to administrators", async () => {
    sessionStorage.setItem(
      "remote-user",
      JSON.stringify({ id: 1, username: "admin", role: "admin" }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "管理后台" }));

    expect(await screen.findByText("设备实时诊断")).toBeTruthy();
    expect(screen.getByText("朋友的手机")).toBeTruthy();
    expect(screen.getByText("friend")).toBeTruthy();
    expect(screen.getByText("在线")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("-1 · timeout")).toBeTruthy();
  });
});
