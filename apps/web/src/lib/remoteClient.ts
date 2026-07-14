import type { DeviceInfo } from "../types";

type Listener = (message: Record<string, unknown>) => void;

export class RemoteClient {
  private socket?: WebSocket;
  private generation = 0;
  constructor(private readonly listener: Listener) {}

  connect(url: string, token: string, deviceDbId: number) {
    this.close();
    const generation = ++this.generation;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => {
      if (generation === this.generation) socket.send(JSON.stringify({ type: "connectController", token, deviceDbId }));
    };
    socket.onmessage = event => {
      if (generation !== this.generation) return;
      try { this.listener(JSON.parse(event.data)); } catch { this.listener({ type: "error", message: "收到无法解析的数据" }); }
    };
    socket.onerror = () => {
      if (generation === this.generation) this.listener({ type: "connectionError", message: "无法连接服务器" });
    };
    socket.onclose = () => {
      if (generation === this.generation) { this.socket = undefined; this.listener({ type: "connectionClosed" }); }
    };
  }

  send(type: string, data: Record<string, unknown> = {}) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type, ...data }));
  }
  launch(packageName: string) { this.send("launchApp", { packageName }); }
  gesture(action: "tap" | "swipe", data: Record<string, number>) { this.send("gesture", { action, ...data }); }
  close() { this.generation++; const socket = this.socket; this.socket = undefined; socket?.close(); }
}

export const demoDevice: DeviceInfo = {
  name: "我的 Android 手机", model: "等待连接", androidVersion: "—", battery: 0,
  apps: []
};
