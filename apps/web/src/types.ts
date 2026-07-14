export interface RemoteApp { label: string; packageName: string }
export interface DeviceInfo { name: string; model: string; androidVersion: string; battery: number; apps: RemoteApp[] }
export type ConnectionState = "idle" | "connecting" | "online" | "offline" | "error";
