const apiBase = import.meta.env.VITE_API_BASE ?? (location.port === "5173" || location.port === "4173" ? "" : "/xiaoming");
export interface User { id:number; username:string; role:"admin"|"user" }
export interface AndroidRelease { version: string; versionCode: number; filename: string; size: number; sha256: string }
export interface SavedDevice { id:number; device_id:string; name:string; last_seen_at:string|null; created_at:string; updated_at:string; online?:boolean }
export interface AdminUser { id:number; username:string; role:"admin"|"user"; active:number; created_at:string; updated_at:string }
export interface DeviceDiagnostic {
  id: number;
  user_id: number;
  device_id: string;
  name: string;
  owner_username: string;
  last_seen_at: string | null;
  session: {
    online: boolean;
    connectedAt: string | null;
    disconnectedAt: string | null;
    lastMessageAt: string | null;
    lastFrameAt: string | null;
    lastCaptureError: {
      code: number | string;
      reason?: string;
      at: string;
    } | null;
    controllerCount: number;
  };
}
async function request<T>(path:string, options:RequestInit={}, token?:string):Promise<T>{const response=await fetch(`${apiBase}${path}`,{...options,headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{}) ,...(options.headers??{})}});let body:any={};try{body=await response.json()}catch{}if(!response.ok)throw new Error(body.message??`请求失败 (${response.status})`);return body as T;}
export const api={
androidRelease:(token:string)=>request<AndroidRelease>("/api/downloads/android",{},token),
downloadAndroid:async(token:string,filename:string)=>{
  const response=await fetch(`${apiBase}/api/downloads/android/${encodeURIComponent(filename)}`,{headers:{Authorization:`Bearer ${token}`}});
  if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.message??`下载失败 (${response.status})`)}
  return response.blob();
},login:(username:string,password:string)=>request<{token:string;user:User}>("/api/auth/login",{method:"POST",body:JSON.stringify({username,password})}),devices:(token:string)=>request<{devices:SavedDevice[]}>("/api/devices",{},token),addDevice:(token:string,data:{name:string;deviceId:string;accessKey:string})=>request<{device:SavedDevice}>("/api/devices",{method:"POST",body:JSON.stringify(data)},token),renameDevice:(token:string,id:number,name:string)=>request<{device:SavedDevice}>(`/api/devices/${id}`,{method:"PATCH",body:JSON.stringify({name})},token),deleteDevice:(token:string,id:number)=>request<void>(`/api/devices/${id}`,{method:"DELETE"},token),users:(token:string)=>request<{users:AdminUser[]}>("/api/admin/users",{},token),diagnostics:(token:string)=>request<{generatedAt:string;devices:DeviceDiagnostic[]}>("/api/admin/diagnostics",{},token),addUser:(token:string,data:{username:string;password:string;role:string})=>request<{user:AdminUser}>("/api/admin/users",{method:"POST",body:JSON.stringify(data)},token),updateUser:(token:string,id:number,data:Record<string,unknown>)=>request<{user:AdminUser}>(`/api/admin/users/${id}`,{method:"PATCH",body:JSON.stringify(data)},token),deleteUser:(token:string,id:number)=>request<void>(`/api/admin/users/${id}`,{method:"DELETE"},token)};
