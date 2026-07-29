import { describe, expect, it, vi } from "vitest";
import { SessionRegistry } from "./session.js";

const socket = () => ({ readyState: 1, send: vi.fn(), close: vi.fn() }) as any;

describe("SessionRegistry", () => {
  it("forwards commands and tracks online devices", () => {
    const registry = new SessionRegistry();
    const device = socket();
    registry.registerDevice({ socket: device, databaseId: 1, userId: 1, deviceId: "phone-1" });
    expect(registry.isOnline("phone-1")).toBe(true);
    registry.forwardToDevice("phone-1", '{"type":"home"}');
    expect(device.send).toHaveBeenCalledWith('{"type":"home"}');
  });

  it("broadcasts device status when disconnected", () => {
    const registry = new SessionRegistry();
    const device = socket();
    const controller = socket();
    registry.registerDevice({ socket: device, databaseId: 1, userId: 1, deviceId: "phone-1" });
    registry.addController("phone-1", controller);
    registry.removeDevice("phone-1", device);
    expect(controller.send).toHaveBeenCalledWith(
      '{"type":"deviceStatus","online":false}',
    );
  });

  it("records frames, screenshot errors, and controller count", () => {
    const registry = new SessionRegistry();
    const device = socket();
    registry.registerDevice({ socket: device, databaseId: 1, userId: 1, deviceId: "phone-1" });
    registry.addController("phone-1", socket());
    registry.addController("phone-1", socket());
    registry.recordDeviceMessage("phone-1", { type: "screenFrame", data: "ignored" });
    registry.recordDeviceMessage("phone-1", {
      type: "captureError",
      code: -1,
      reason: "timeout",
    });

    const result = registry.diagnosticsFor("phone-1");
    expect(result.online).toBe(true);
    expect(result.connectedAt).not.toBeNull();
    expect(result.lastFrameAt).not.toBeNull();
    expect(result.lastCaptureError).toMatchObject({ code: -1, reason: "timeout" });
    expect(result.controllerCount).toBe(2);
  });
});
