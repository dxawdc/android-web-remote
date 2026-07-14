import { useRef } from "react";
import { Home, LogOut, RotateCw, Square, Sun, Undo2 } from "lucide-react";

interface Props { frame?: string; onCommand(type: string): void; onGesture(action: "tap"|"swipe", data: Record<string,number>): void; onDisconnect(): void }
export function PhoneViewer({ frame, onCommand, onGesture, onDisconnect }: Props) {
  const start = useRef<{x:number;y:number}|null>(null);
  const point = (e: React.PointerEvent) => { const r=e.currentTarget.getBoundingClientRect(); return {x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height}; };
  return <main className="viewer">
    <div className="viewer-heading"><div><h2>实时屏幕</h2><span>鼠标点击或拖动即可操作手机</span></div><span className="authorized">设备用户已授权</span></div>
    <div className="phone-shell">
      <div className="phone-screen" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId); start.current=point(e);}} onPointerUp={e=>{ const end=point(e); const s=start.current; start.current=null; if(!s)return; const distance=Math.hypot(end.x-s.x,end.y-s.y); distance<.025?onGesture("tap",end):onGesture("swipe",{startX:s.x,startY:s.y,endX:end.x,endY:end.y}); }}>
        {frame ? <img src={`data:image/jpeg;base64,${frame}`} alt="手机实时屏幕" draggable={false}/> : <div className="screen-empty"><div className="screen-lock">✓</div><strong>屏幕连接已就绪</strong><span>等待手机发送首帧画面</span></div>}
      </div>
    </div>
    <div className="control-bar">
      <button onClick={()=>onCommand("back")}><Undo2/><span>返回</span></button>
      <button onClick={()=>onCommand("home")}><Home/><span>主页</span></button>
      <button onClick={()=>onCommand("recents")}><Square/><span>最近任务</span></button>
      <button onClick={()=>onCommand("rotate")}><RotateCw/><span>旋转屏幕</span></button>
      <button onClick={()=>onCommand("wakeScreen")}><Sun/><span>唤醒屏幕</span></button>
      <i/>
      <button className="danger" onClick={onDisconnect}><LogOut/><span>断开连接</span></button>
    </div>
    <p className="privacy-note">为保障隐私，敏感页面可能无法显示或被系统限制操作。</p>
  </main>;
}
