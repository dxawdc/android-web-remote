import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DiagnosticLogStore } from "./diagnostic-logs.js";

const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); directories.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })); });
const fixture = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diagnostic-store-")); directories.push(dir); return { dir, store: new DiagnosticLogStore(dir) }; };
const upload = { version: "0.9.0", uploadId: "1:2", lines: ["[连接] 离线", "[认证] 成功"] };

describe("persisted diagnostic snapshots", () => {
  it("survives a new store instance, replaces snapshots without duplicating and removes deleted devices", () => {
    const { dir, store } = fixture();
    expect(store.save(7, upload)).toBe(true);
    expect(new DiagnosticLogStore(dir).read(7)?.lines).toEqual(upload.lines);
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 6000);
    expect(store.save(7, { ...upload, lines: ["[日志] 日志已清空"] })).toBe(true);
    expect(store.read(7)?.lines).toEqual(["[日志] 日志已清空"]);
    expect(store.read(8)).toBeNull();
    store.remove(7); expect(store.read(7)).toBeNull();
  });

  it("rejects oversized or malformed uploads and throttles repeated writes", () => {
    const { store } = fixture();
    for (const invalid of [null, [12], ["x".repeat(601)], Array(301).fill("x"), ["a\nb"]]) {
      expect(store.save(1, { ...upload, lines: invalid })).toBe(false);
    }
    expect(store.save(1, { ...upload, version: "../private" })).toBe(false);
    expect(store.save(1, { ...upload, uploadId: {} })).toBe(false);
    expect(store.read(1)).toBeNull();
    expect(store.save(1, upload)).toBe(true);
    expect(store.save(1, { ...upload, lines: ["too soon"] })).toBe(false);
    expect(store.read(1)?.lines).toEqual(upload.lines);
  });
});
