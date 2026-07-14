import { FormEvent, useState } from "react";
import { KeyRound, LogIn, UserRound } from "lucide-react";

export function ConnectDialog({ onLogin, error }: { onLogin:(username:string,password:string)=>void; error?:string }) {
  const [username,setUsername]=useState(""); const [password,setPassword]=useState("");
  const submit=(event:FormEvent)=>{event.preventDefault();onLogin(username,password)};
  return <div className="connect-page"><form className="connect-panel" onSubmit={submit}><div className="brand-mark"><LogIn size={23}/></div><h1>登录远程控制</h1><p>登录后管理属于你的 Android 设备，并开始远程协助。</p><label><span><UserRound size={16}/>账号</span><input aria-label="账号" autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} required /></label><label><span><KeyRound size={16}/>密码</span><input aria-label="密码" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required /></label><button type="submit">登录</button>{error&&<div className="form-error">{error}</div>}<small>请使用管理员创建的账号登录。</small></form></div>;
}
