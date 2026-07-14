import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { RemoteApp } from "../types";

export function AppPanel({ apps, onLaunch }: {apps: RemoteApp[]; onLaunch(packageName:string):void}) {
  const [query,setQuery]=useState("");
  const filtered=useMemo(()=>apps.filter(a=>(a.label+a.packageName).toLowerCase().includes(query.toLowerCase())),[apps,query]);
  return <aside className="app-panel"><h2>已安装应用 <span>({apps.length})</span></h2><div className="search"><Search size={17}/><input aria-label="搜索应用" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索应用名称或包名"/></div><div className="app-list">
    {filtered.map(app=><div className="app-row" key={app.packageName}><div className="app-icon">{app.label.slice(0,1)}</div><div><strong>{app.label}</strong><small>{app.packageName}</small></div><button onClick={()=>onLaunch(app.packageName)}>打开</button></div>)}
    {!filtered.length&&<div className="empty-list">{apps.length?"没有匹配的应用":"等待手机返回应用列表"}</div>}
  </div></aside>;
}
