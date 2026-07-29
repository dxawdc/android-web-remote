import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { createDevice, createUser, deleteDevice, deleteUser, findUser, getDeviceByDeviceId, getDeviceForUser, issueToken, listAllDevicesForDiagnostics, listDevices, listUsers, markDeviceSeen, requireAdmin, requireAuth, updateDeviceName, updateUser, verifyDeviceKey, verifyPassword, verifyToken, type AuthRequest } from "./server-api.js";
import { SessionRegistry } from "./session.js";

const app=express();app.use(cors());app.use(express.json({limit:"1mb"}));
app.get("/health",(_req,res)=>res.json({ok:true}));
app.post("/api/auth/login",(req,res)=>{const username=String(req.body?.username??"").trim();const password=String(req.body?.password??"");const user=findUser(username);if(!user||!user.active||!verifyPassword(password,user.password_hash))return res.status(401).json({message:"账号或密码错误"});return res.json({token:issueToken(user),user:{id:user.id,username:user.username,role:user.role}});});
app.get("/api/me",requireAuth,(req:AuthRequest,res)=>res.json({user:req.user}));
app.get("/api/devices",requireAuth,(req:AuthRequest,res)=>res.json({devices:listDevices(req.user!.id).map(device=>({...device,online:sessions.isOnline(device.device_id)}))}));
app.post("/api/devices",requireAuth,(req:AuthRequest,res)=>{try{const name=String(req.body?.name??"").trim();const deviceId=String(req.body?.deviceId??"").trim();const accessKey=String(req.body?.accessKey??"");if(!name||!deviceId||accessKey.length<6)return res.status(400).json({message:"名称、设备 ID 和至少 6 位访问密钥不能为空"});const device=createDevice(req.user!.id,deviceId,name,accessKey);return res.status(201).json({device});}catch(error:any){if(String(error?.message).includes("UNIQUE"))return res.status(409).json({message:"该设备已被添加"});return res.status(500).json({message:"设备保存失败"});}});
app.patch("/api/devices/:id",requireAuth,(req:AuthRequest,res)=>{const name=String(req.body?.name??"").trim();if(!name)return res.status(400).json({message:"设备名称不能为空"});const device=updateDeviceName(Number(req.params.id),req.user!.id,name);return device?res.json({device}):res.status(404).json({message:"设备不存在"});});
app.delete("/api/devices/:id",requireAuth,(req:AuthRequest,res)=>deleteDevice(Number(req.params.id),req.user!.id)?res.status(204).end():res.status(404).json({message:"设备不存在"}));
app.get("/api/admin/users",requireAuth,requireAdmin,(_req,res)=>res.json({users:listUsers()}));
app.get("/api/admin/diagnostics",requireAuth,requireAdmin,(_req,res)=>res.json({
  generatedAt:new Date().toISOString(),
  devices:listAllDevicesForDiagnostics().map(device=>({
    ...device,
    session:sessions.diagnosticsFor(device.device_id),
  })),
}));
app.post("/api/admin/users",requireAuth,requireAdmin,(req:AuthRequest,res)=>{try{const username=String(req.body?.username??"").trim();const password=String(req.body?.password??"");const role=req.body?.role==="admin"?"admin":"user";if(!username||password.length<8)return res.status(400).json({message:"用户名不能为空，密码至少 8 位"});return res.status(201).json({user:createUser(username,password,role)});}catch(error:any){if(String(error?.message).includes("UNIQUE"))return res.status(409).json({message:"用户名已存在"});return res.status(500).json({message:"账号创建失败"});}});
app.patch("/api/admin/users/:id",requireAuth,requireAdmin,(req:AuthRequest,res)=>{const id=Number(req.params.id);if(id===req.user!.id&&req.body?.active===false)return res.status(400).json({message:"不能禁用当前管理员账号"});try{const user=updateUser(id,{username:req.body?.username,password:req.body?.password,role:req.body?.role,active:req.body?.active});return user?res.json({user}):res.status(404).json({message:"账号不存在"});}catch(error:any){if(String(error?.message).includes("UNIQUE"))return res.status(409).json({message:"用户名已存在"});return res.status(500).json({message:"账号修改失败"});}});
app.delete("/api/admin/users/:id",requireAuth,requireAdmin,(req:AuthRequest,res)=>{if(Number(req.params.id)===req.user!.id)return res.status(400).json({message:"不能删除当前管理员账号"});return deleteUser(Number(req.params.id))?res.status(204).end():res.status(404).json({message:"账号不存在"});});

const server=createServer(app);const wss=new WebSocketServer({server,path:"/ws",maxPayload:4*1024*1024});const sessions=new SessionRegistry();
const reply=(socket:WebSocket,value:unknown)=>socket.send(JSON.stringify(value));
wss.on("connection",socket=>{let role:"device"|"controller"|undefined;let deviceId="";let lastSeenSavedAt=0;
  socket.on("message",raw=>{let message:Record<string,any>;try{message=JSON.parse(raw.toString());}catch{return reply(socket,{type:"error",message:"消息格式错误"});}
    if(!role){
      if(message.type==="registerDevice"){const record=getDeviceByDeviceId(String(message.deviceId??""));if(!record||!verifyDeviceKey(record,String(message.accessKey??"")))return reply(socket,{type:"authFailed",message:"设备尚未添加到账号或访问密钥错误"});role="device";deviceId=record.device_id;markDeviceSeen(record.id);sessions.registerDevice({socket,databaseId:record.id,userId:record.user_id,deviceId});reply(socket,{type:"registered",deviceId});return;}
      if(message.type==="connectController"){try{const payload=verifyToken(String(message.token??""));const record=getDeviceForUser(Number(message.deviceDbId),Number(payload.sub));if(!record)return reply(socket,{type:"authFailed",message:"无权访问此设备"});role="controller";deviceId=record.device_id;sessions.addController(deviceId,socket);reply(socket,{type:"deviceStatus",online:sessions.isOnline(deviceId)});if(sessions.isOnline(deviceId)){sessions.forwardToDevice(deviceId,JSON.stringify({type:"getDeviceInfo"}));sessions.forwardToDevice(deviceId,JSON.stringify({type:"startStream"}));}return;}catch{return reply(socket,{type:"authFailed",message:"登录凭证无效"});}}
      return reply(socket,{type:"authFailed",message:"请先完成认证"});
    }
    if(role==="controller")sessions.forwardToDevice(deviceId,raw.toString());else {const record=getDeviceByDeviceId(deviceId);if(!record){socket.close(4003,"device removed");return;}sessions.recordDeviceMessage(deviceId,message);const now=Date.now();if(now-lastSeenSavedAt>=15_000){markDeviceSeen(record.id);lastSeenSavedAt=now;}sessions.broadcastToControllers(deviceId,raw.toString());}
  });
  socket.on("close",()=>{if(role==="device")sessions.removeDevice(deviceId,socket);if(role==="controller")sessions.removeController(deviceId,socket);});
});
const port=Number(process.env.PORT??8787);server.listen(port,"0.0.0.0",()=>console.log(`Remote control server listening on :${port}`));
export {server};
