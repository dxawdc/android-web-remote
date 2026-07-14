import { describe, expect, it, vi } from "vitest";
import { SessionRegistry } from "./session.js";

const socket=()=>({readyState:1,send:vi.fn(),close:vi.fn()}) as any;
describe("SessionRegistry",()=>{it("forwards commands and tracks online devices",()=>{const registry=new SessionRegistry();const device=socket();registry.registerDevice({socket:device,databaseId:1,userId:1,deviceId:"phone-1"});expect(registry.isOnline("phone-1")).toBe(true);registry.forwardToDevice("phone-1",'{"type":"home"}');expect(device.send).toHaveBeenCalledWith('{"type":"home"}');});it("broadcasts device status when disconnected",()=>{const registry=new SessionRegistry();const device=socket();const controller=socket();registry.registerDevice({socket:device,databaseId:1,userId:1,deviceId:"phone-1"});registry.addController("phone-1",controller);registry.removeDevice("phone-1",device);expect(controller.send).toHaveBeenCalledWith('{"type":"deviceStatus","online":false}');});});
