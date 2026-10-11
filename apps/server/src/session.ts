import type { WebSocket } from "ws";

export interface ConnectedDevice {
  socket: WebSocket;
  databaseId: number;
  userId: number;
  deviceId: string;
}

export type ConnectedController = ConnectedDevice;

export interface CaptureErrorSnapshot {
  code: number | string;
  reason?: string;
  at: string;
}

export interface DeviceSessionDiagnostics {
  online: boolean;
  connectedAt: string | null;
  disconnectedAt: string | null;
  lastMessageAt: string | null;
  lastFrameAt: string | null;
  lastCaptureError: CaptureErrorSnapshot | null;
  controllerCount: number;
}

type MutableDiagnostics = Omit<DeviceSessionDiagnostics, "controllerCount">;

const now = () => new Date().toISOString();
const emptyDiagnostics = (): MutableDiagnostics => ({
  online: false,
  connectedAt: null,
  disconnectedAt: null,
  lastMessageAt: null,
  lastFrameAt: null,
  lastCaptureError: null,
});

export class SessionRegistry {
  private readonly devices = new Map<string, ConnectedDevice>();
  private readonly controllers = new Map<string, Map<WebSocket, ConnectedController>>();
  private readonly diagnostics = new Map<string, MutableDiagnostics>();

  registerDevice(device: ConnectedDevice) {
    const previous = this.devices.get(device.deviceId);
    if (previous && (previous.databaseId !== device.databaseId || previous.userId !== device.userId)) {
      this.revokeDevice(device.deviceId);
    }
    this.devices.get(device.deviceId)?.socket.close(4001, "设备重新连接");
    this.devices.set(device.deviceId, device);
    const diagnostic = this.diagnostics.get(device.deviceId) ?? emptyDiagnostics();
    diagnostic.online = true;
    diagnostic.connectedAt = now();
    diagnostic.disconnectedAt = null;
    diagnostic.lastMessageAt = diagnostic.connectedAt;
    this.diagnostics.set(device.deviceId, diagnostic);
    this.broadcastToControllers(
      device.deviceId,
      JSON.stringify({ type: "deviceStatus", online: true }),
    );
  }

  removeDevice(deviceId: string, socket: WebSocket) {
    if (this.devices.get(deviceId)?.socket !== socket) return;
    this.devices.delete(deviceId);
    const diagnostic = this.diagnostics.get(deviceId) ?? emptyDiagnostics();
    diagnostic.online = false;
    diagnostic.disconnectedAt = now();
    this.diagnostics.set(deviceId, diagnostic);
    this.broadcastToControllers(deviceId, JSON.stringify({ type: "deviceStatus", online: false }));
  }

  recordDeviceMessage(deviceId: string, message: Record<string, unknown>) {
    const diagnostic = this.diagnostics.get(deviceId) ?? emptyDiagnostics();
    const timestamp = now();
    diagnostic.lastMessageAt = timestamp;
    if (message.type === "screenFrame") diagnostic.lastFrameAt = timestamp;
    if (message.type === "captureError") {
      diagnostic.lastCaptureError = {
        code: typeof message.code === "number" || typeof message.code === "string"
          ? message.code
          : "unknown",
        reason: typeof message.reason === "string" ? message.reason : undefined,
        at: timestamp,
      };
    }
    this.diagnostics.set(deviceId, diagnostic);
  }

  diagnosticsFor(deviceId: string): DeviceSessionDiagnostics {
    const diagnostic = this.diagnostics.get(deviceId) ?? emptyDiagnostics();
    return {
      ...diagnostic,
      online: this.devices.has(deviceId),
      controllerCount: this.controllers.get(deviceId)?.size ?? 0,
    };
  }

  isOnline(deviceId: string) {
    return this.devices.has(deviceId);
  }

  isCurrentDevice(deviceId: string, socket: WebSocket) {
    return this.devices.get(deviceId)?.socket === socket;
  }

  hasController(deviceId: string, socket: WebSocket) {
    return this.controllers.get(deviceId)?.has(socket) ?? false;
  }

  addController(controller: ConnectedController) {
    const set = this.controllers.get(controller.deviceId) ?? new Map<WebSocket, ConnectedController>();
    set.set(controller.socket, controller);
    this.controllers.set(controller.deviceId, set);
  }

  removeController(deviceId: string, socket: WebSocket) {
    const set = this.controllers.get(deviceId);
    if (!set?.delete(socket)) return;
    if (!set.size) {
      this.controllers.delete(deviceId);
      this.forwardToDevice(deviceId, JSON.stringify({ type: "stopStream" }));
    }
  }

  revokeDevice(deviceId: string) {
    this.forwardToDevice(deviceId, JSON.stringify({ type: "stopStream" }));
    const device = this.devices.get(deviceId);
    const controllers = this.controllers.get(deviceId);
    // Remove routing immediately; close events arrive asynchronously.
    this.devices.delete(deviceId);
    this.controllers.delete(deviceId);
    this.diagnostics.delete(deviceId);
    controllers?.forEach(({ socket }) => socket.close(4003, "access revoked"));
    device?.socket.close(4003, "access revoked");
  }

  revokeUser(userId: number) {
    const deviceIds = new Set<string>();
    this.devices.forEach(device => {
      if (device.userId === userId) deviceIds.add(device.deviceId);
    });
    this.controllers.forEach((controllers, deviceId) => {
      if ([...controllers.values()].some(controller => controller.userId === userId)) {
        deviceIds.add(deviceId);
      }
    });
    deviceIds.forEach(deviceId => this.revokeDevice(deviceId));
  }

  forwardToDevice(deviceId: string, payload: string) {
    const socket = this.devices.get(deviceId)?.socket;
    if (socket?.readyState === 1) socket.send(payload);
  }

  broadcastToControllers(deviceId: string, payload: string) {
    this.controllers.get(deviceId)?.forEach(({ socket }) => {
      if (socket.readyState === 1) socket.send(payload);
    });
  }
}
