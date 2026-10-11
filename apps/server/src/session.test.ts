import { describe, expect, it, vi } from "vitest";
import { SessionRegistry } from "./session.js";

const socket = () => ({ readyState: 1, send: vi.fn(), close: vi.fn() }) as any;
const controller = (socket: any) => ({ socket, databaseId: 1, userId: 1, deviceId: "phone-1" });

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
    registry.addController({ socket: controller, databaseId: 1, userId: 1, deviceId: "phone-1" });
    registry.removeDevice("phone-1", device);
    expect(controller.send).toHaveBeenCalledWith(
      '{"type":"deviceStatus","online":false}',
    );
  });

  it("records frames, screenshot errors, and controller count", () => {
    const registry = new SessionRegistry();
    const device = socket();
    registry.registerDevice({ socket: device, databaseId: 1, userId: 1, deviceId: "phone-1" });
    registry.addController(controller(socket()));
    registry.addController(controller(socket()));
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

  it("stops streaming only after the last controller leaves", () => {
    const registry = new SessionRegistry();
    const device = socket();
    const first = socket();
    const second = socket();
    registry.registerDevice(controller(device));
    registry.addController(controller(first));
    registry.addController(controller(second));
    registry.removeController("phone-1", first);
    expect(device.send).not.toHaveBeenCalled();
    registry.removeController("phone-1", second);
    expect(device.send).toHaveBeenCalledExactlyOnceWith('{"type":"stopStream"}');
    registry.removeController("phone-1", second);
    expect(device.send).toHaveBeenCalledTimes(1);
  });

  it("does not let delayed close events remove or stop a replacement session", () => {
    const registry = new SessionRegistry();
    const oldDevice = socket();
    const oldController = socket();
    registry.registerDevice(controller(oldDevice));
    registry.addController(controller(oldController));
    registry.revokeDevice("phone-1");
    const newDevice = socket();
    registry.registerDevice({ ...controller(newDevice), databaseId: 2, userId: 2 });
    registry.removeDevice("phone-1", oldDevice);
    registry.removeController("phone-1", oldController);
    expect(registry.isCurrentDevice("phone-1", newDevice)).toBe(true);
    expect(newDevice.send).not.toHaveBeenCalled();
    expect(oldController.close).toHaveBeenCalledWith(4003, "access revoked");
  });
});
