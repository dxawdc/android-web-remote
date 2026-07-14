import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getUser, jwtSecret, type UserRow } from "./db.js";

export interface AuthRequest extends Request { user?: Pick<UserRow,"id"|"username"|"role"> }
export function issueToken(user: UserRow) { return jwt.sign({ sub:user.id, username:user.username, role:user.role }, jwtSecret, { expiresIn:"7d" }); }
export function verifyToken(token: string) { return jwt.verify(token, jwtSecret) as unknown as { sub:number; username:string; role:"admin"|"user" }; }
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) { try { const raw=req.headers.authorization?.replace(/^Bearer\s+/i,""); if(!raw) return res.status(401).json({message:"需要登录"}); const payload=verifyToken(raw); const user=getUser(Number(payload.sub)); if(!user||!user.active) return res.status(401).json({message:"账号不可用"}); req.user={id:user.id,username:user.username,role:user.role}; next(); } catch { return res.status(401).json({message:"登录已过期"}); } }
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) { if(req.user?.role!=="admin") return res.status(403).json({message:"需要管理员权限"}); next(); }
