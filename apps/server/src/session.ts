import type { WebSocket } from "ws";

export interface ConnectedDevice { socket: WebSocket; databaseId: number; userId: number; deviceId: string }
export class SessionRegistry {
  private readonly devices = new Map<string, ConnectedDevice>();
  private readonly controllers = new Map<string, Set<WebSocket>>();
  registerDevice(device: ConnectedDevice) { this.devices.get(device.deviceId)?.socket.close(4001, "设备重新连接"); this.devices.set(device.deviceId, device); this.broadcastToControllers(device.deviceId, JSON.stringify({type:"deviceStatus",online:true})); }
  removeDevice(deviceId: string, socket: WebSocket) { if(this.devices.get(deviceId)?.socket===socket){this.devices.delete(deviceId);this.broadcastToControllers(deviceId,JSON.stringify({type:"deviceStatus",online:false}));} }
  isOnline(deviceId: string) { return this.devices.has(deviceId); }
  addController(deviceId: string, socket: WebSocket) { const set=this.controllers.get(deviceId)??new Set<WebSocket>();set.add(socket);this.controllers.set(deviceId,set); }
  removeController(deviceId: string, socket: WebSocket) { const set=this.controllers.get(deviceId);set?.delete(socket);if(!set?.size)this.controllers.delete(deviceId); }
  forwardToDevice(deviceId: string, payload: string) { const socket=this.devices.get(deviceId)?.socket;if(socket?.readyState===1)socket.send(payload); }
  broadcastToControllers(deviceId: string, payload: string) { this.controllers.get(deviceId)?.forEach(socket=>{if(socket.readyState===1)socket.send(payload);}); }
}
