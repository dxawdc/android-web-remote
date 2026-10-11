import { WebSocket, WebSocketServer } from "ws";
import { verifyToken } from "./auth.js";
import { getDeviceByDeviceId, getDeviceForUser, getUser, markDeviceSeen, verifyDeviceKey } from "./db.js";
import { SessionRegistry, type ConnectedDevice } from "./session.js";

export function attachWebSockets(wss: WebSocketServer, sessions: SessionRegistry) {
  wss.on("connection", socket => {
    let role: "device" | "controller" | undefined;
    let identity: ConnectedDevice | undefined;
    let lastSeenSavedAt = 0;

    const reply = (value: unknown) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
    };
    const cleanup = () => {
      if (!identity) return;
      if (role === "device") sessions.removeDevice(identity.deviceId, socket);
      else sessions.removeController(identity.deviceId, socket);
    };
    const revoke = () => {
      cleanup();
      socket.close(4003, "access revoked");
    };

    // Protocol errors (including maxPayload violations) emit error events too.
    socket.on("error", () => { cleanup(); socket.terminate(); });
    socket.on("close", cleanup);
    socket.on("message", raw => {
      if (socket.readyState !== WebSocket.OPEN) return;
      let message: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(raw.toString());
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
            !("type" in parsed) || typeof parsed.type !== "string" || !parsed.type) {
          throw new Error("Invalid message");
        }
        message = parsed as Record<string, unknown>;
      } catch {
        reply({ type: "error", message: "消息格式错误" });
        return;
      }

      try {
        if (!identity) {
          if (message.type === "registerDevice") {
            const record = getDeviceByDeviceId(String(message.deviceId ?? ""));
            if (!record || !getUser(record.user_id)?.active ||
                !verifyDeviceKey(record, String(message.accessKey ?? ""))) {
              reply({ type: "authFailed", message: "设备尚未添加到有效账号或访问密钥错误" });
              return;
            }
            markDeviceSeen(record.id);
            lastSeenSavedAt = Date.now();
            identity = { socket, databaseId: record.id, userId: record.user_id, deviceId: record.device_id };
            role = "device";
            sessions.registerDevice(identity);
            reply({ type: "registered", deviceId: record.device_id });
            return;
          }
          if (message.type === "connectController") {
            let userId: number;
            try {
              userId = Number(verifyToken(String(message.token ?? "")).sub);
            } catch {
              reply({ type: "authFailed", message: "登录凭证无效" });
              return;
            }
            const record = getDeviceForUser(Number(message.deviceDbId), userId);
            if (!getUser(userId)?.active || !record) {
              reply({ type: "authFailed", message: "无权访问此设备" });
              return;
            }
            identity = { socket, databaseId: record.id, userId, deviceId: record.device_id };
            role = "controller";
            sessions.addController(identity);
            reply({ type: "deviceStatus", online: sessions.isOnline(record.device_id) });
            sessions.forwardToDevice(record.device_id, JSON.stringify({ type: "getDeviceInfo" }));
            sessions.forwardToDevice(record.device_id, JSON.stringify({ type: "startStream" }));
            return;
          }
          reply({ type: "authFailed", message: "请先完成认证" });
          return;
        }

        const { databaseId, userId, deviceId } = identity;
        const record = getDeviceForUser(databaseId, userId);
        if (!getUser(userId)?.active || !record || record.device_id !== deviceId) {
          revoke();
          return;
        }
        if (role === "controller") {
          if (!sessions.hasController(deviceId, socket)) { revoke(); return; }
          sessions.forwardToDevice(deviceId, raw.toString());
        } else {
          if (!sessions.isCurrentDevice(deviceId, socket)) { revoke(); return; }
          sessions.recordDeviceMessage(deviceId, message);
          const timestamp = Date.now();
          if (timestamp - lastSeenSavedAt >= 15_000) {
            markDeviceSeen(databaseId);
            lastSeenSavedAt = timestamp;
          }
          sessions.broadcastToControllers(deviceId, raw.toString());
        }
      } catch {
        // Storage/processing failures must not terminate unrelated sessions.
        cleanup();
        socket.close(1011, "message processing failed");
      }
    });
  });
}
