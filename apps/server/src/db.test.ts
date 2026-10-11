import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

function start(dataDir: string) {
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    `await import(${JSON.stringify(new URL("./db.ts", import.meta.url).href)})`], {
    env: { ...process.env, DATA_DIR: dataDir, ADMIN_USERNAME: "test-bootstrap",
      ADMIN_PASSWORD: randomBytes(24).toString("hex"), JWT_SECRET: randomBytes(32).toString("hex") },
    encoding: "utf8", timeout: 10000, windowsHide: true,
  });
}

describe("database startup safety", () => {
  it("aborts on read errors without treating the existing path as an empty database", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "remote-db-test-"));
    try {
      const file = path.join(directory, "remote-control.json");
      mkdirSync(file);
      const result = start(directory);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Cannot read the existing database");
      expect(statSync(file).isDirectory()).toBe(true);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it.each([
    '{"users":[{"username":"recoverable"}],"devices":[',
    "null",
    '{"users":[],"devices":[{"id":1}],"nextUserId":1,"nextDeviceId":2}',
  ])("preserves damaged or invalid data instead of bootstrapping over it (%#)", content => {
    const directory = mkdtempSync(path.join(tmpdir(), "remote-db-test-"));
    try {
      const file = path.join(directory, "remote-control.json");
      writeFileSync(file, content);
      const result = start(directory);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Existing data was not overwritten");
      expect(readFileSync(file, "utf8")).toBe(content);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("initializes a missing file once and preserves valid data on restart", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "remote-db-test-"));
    try {
      const file = path.join(directory, "remote-control.json");
      expect(start(directory).status).toBe(0);
      const original = readFileSync(file, "utf8");
      expect(JSON.parse(original).users).toHaveLength(1);
      expect(start(directory).status).toBe(0);
      expect(readFileSync(file, "utf8")).toBe(original);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
