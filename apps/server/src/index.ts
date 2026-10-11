import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { createDevice, createUser, deleteDevice, deleteUser, findUser, getDeviceForUser, issueToken, listAllDevicesForDiagnostics, listDevices, listUsers, requireAdmin, requireAuth, updateDeviceName, updateUser, verifyPassword, type AuthRequest } from "./server-api.js";
import { SessionRegistry } from "./session.js";
import { attachWebSockets } from "./websocket.js";
import { attachDownloads } from "./downloads.js";

const app=express();app.use(cors());app.use(express.json({limit:"1mb"}));
attachDownloads(app);
app.get("/health",(_req,res)=>res.json({ok:true}));
app.post("/api/auth/login",(req,res)=>{const username=String(req.body?.username??"").trim();const password=String(req.body?.password??"");const user=findUser(username);if(!user||!user.active||!verifyPassword(password,user.password_hash))return res.status(401).json({message:"账号或密码错误"});return res.json({token:issueToken(user),user:{id:user.id,username:user.username,role:user.role}});});
app.get("/api/me",requireAuth,(req:AuthRequest,res)=>res.json({user:req.user}));
app.get("/api/devices",requireAuth,(req:AuthRequest,res)=>res.json({devices:listDevices(req.user!.id).map(device=>({...device,online:sessions.isOnline(device.device_id)}))}));
app.post("/api/devices",requireAuth,(req:AuthRequest,res)=>{try{const name=String(req.body?.name??"").trim();const deviceId=String(req.body?.deviceId??"").trim();const accessKey=String(req.body?.accessKey??"");if(!name||!deviceId||accessKey.length<6)return res.status(400).json({message:"名称、设备 ID 和至少 6 位访问密钥不能为空"});const device=createDevice(req.user!.id,deviceId,name,accessKey);return res.status(201).json({device});}catch(error:any){if(String(error?.message).includes("UNIQUE"))return res.status(409).json({message:"该设备已被添加"});return res.status(500).json({message:"设备保存失败"});}});
app.patch("/api/devices/:id",requireAuth,(req:AuthRequest,res)=>{const name=String(req.body?.name??"").trim();if(!name)return res.status(400).json({message:"设备名称不能为空"});const device=updateDeviceName(Number(req.params.id),req.user!.id,name);return device?res.json({device}):res.status(404).json({message:"设备不存在"});});
app.delete("/api/devices/:id", requireAuth, (req: AuthRequest, res) => {
  const record = getDeviceForUser(Number(req.params.id), req.user!.id);
  if (!record || !deleteDevice(record.id, req.user!.id)) return res.status(404).json({ message: "设备不存在" });
  sessions.revokeDevice(record.device_id);
  return res.status(204).end();
});
app.get("/api/admin/users",requireAuth,requireAdmin,(_req,res)=>res.json({users:listUsers()}));
app.get("/api/admin/diagnostics",requireAuth,requireAdmin,(_req,res)=>res.json({
  generatedAt:new Date().toISOString(),
  devices:listAllDevicesForDiagnostics().map(device=>({
    ...device,
    session:sessions.diagnosticsFor(device.device_id),
  })),
}));
app.post("/api/admin/users",requireAuth,requireAdmin,(req:AuthRequest,res)=>{try{const username=String(req.body?.username??"").trim();const password=String(req.body?.password??"");const role=req.body?.role==="admin"?"admin":"user";if(!username||password.length<8)return res.status(400).json({message:"用户名不能为空，密码至少 8 位"});return res.status(201).json({user:createUser(username,password,role)});}catch(error:any){if(String(error?.message).includes("UNIQUE"))return res.status(409).json({message:"用户名已存在"});return res.status(500).json({message:"账号创建失败"});}});
app.patch("/api/admin/users/:id", requireAuth, requireAdmin, (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const { username, password, role, active } = req.body ?? {};
  if ((username !== undefined && (typeof username !== "string" || !username.trim())) ||
      (password !== undefined && (typeof password !== "string" || password.length < 8)) ||
      (role !== undefined && role !== "admin" && role !== "user") ||
      (active !== undefined && typeof active !== "boolean")) {
    return res.status(400).json({ message: "账号信息格式错误，密码至少 8 位" });
  }
  if (id === req.user!.id && (active === false || role === "user")) {
    return res.status(400).json({ message: "不能禁用或降级当前管理员账号" });
  }
  try {
    const user = updateUser(id, { username, password, role, active });
    if (!user) return res.status(404).json({ message: "账号不存在" });
    if (!user.active) sessions.revokeUser(id);
    return res.json({ user });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return res.status(409).json({ message: "用户名已存在" });
    }
    return res.status(500).json({ message: "账号修改失败" });
  }
});
app.delete("/api/admin/users/:id", requireAuth, requireAdmin, (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) return res.status(400).json({ message: "不能删除当前管理员账号" });
  if (!deleteUser(id)) return res.status(404).json({ message: "账号不存在" });
  sessions.revokeUser(id);
  return res.status(204).end();
});

const server=createServer(app);const wss=new WebSocketServer({server,path:"/ws",maxPayload:4*1024*1024});const sessions=new SessionRegistry();
attachWebSockets(wss, sessions);
const port=Number(process.env.PORT??8787);server.listen(port,"0.0.0.0",()=>console.log(`Remote control server listening on :${port}`));
export {server, wss};
