import { useRef } from "react";
import { Home, LoaderCircle, LogOut, RefreshCw, RotateCw, Square, Sun, TriangleAlert, Undo2 } from "lucide-react";
import type { FrameStage } from "../types";

interface Props {
  commandFeedback?: string;
  frame?: string;
  frameStage: FrameStage;
  frameIssue?: string;
  onRetry(): void;
  onFrameError(): void;
  onCommand(type: string): void;
  onGesture(action: "tap" | "swipe", data: Record<string, number>): void;
  onDisconnect(): void;
}

const stageCopy: Record<FrameStage, { title: string; detail: string }> = {
  waiting: {
    title: "正在获取首帧画面",
    detail: "手机已连接，正在启动屏幕传输",
  },
  retrying: {
    title: "正在重新请求画面",
    detail: "首帧暂未到达，系统会继续自动重试",
  },
  reconnecting: {
    title: "正在重新建立画面连接",
    detail: "连接保持在线，请稍候",
  },
  failed: {
    title: "暂时无法获取手机画面",
    detail: "可以手动重试，或检查手机是否停留在安全页面",
  },
};

export function PhoneViewer({
  commandFeedback,
  frame,
  frameStage,
  frameIssue,
  onRetry,
  onFrameError,
  onCommand,
  onGesture,
  onDisconnect,
}: Props) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const point = (event: React.PointerEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  };
  const copy = stageCopy[frameStage];
  const showRetry = frameStage === "retrying" || frameStage === "failed";

  return (
    <main className="viewer">
      <div className="viewer-heading">
        <div>
          <h2>实时屏幕</h2>
          <span>鼠标点击或拖动即可操作手机</span>
        </div>
        <span className="authorized">设备用户已授权</span>
      </div>
      <div className="phone-shell">
        <div
          className="phone-screen"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            start.current = point(event);
          }}
          onPointerUp={(event) => {
            const end = point(event);
            const initial = start.current;
            start.current = null;
            if (!initial) return;
            const distance = Math.hypot(end.x - initial.x, end.y - initial.y);
            distance < 0.025
              ? onGesture("tap", end)
              : onGesture("swipe", {
                  startX: initial.x,
                  startY: initial.y,
                  endX: end.x,
                  endY: end.y,
                });
          }}
        >
          {frame ? (
            <img
              src={`data:image/jpeg;base64,${frame}`}
              alt="手机实时屏幕"
              draggable={false}
              onError={onFrameError}
            />
          ) : (
            <div className={`screen-empty ${frameStage}`}>
              <div className="screen-status-icon" aria-hidden="true">
                {frameStage === "failed" ? (
                  <TriangleAlert />
                ) : frameStage === "retrying" ? (
                  <RefreshCw />
                ) : (
                  <LoaderCircle />
                )}
              </div>
              <strong>{copy.title}</strong>
              <span>{frameIssue || copy.detail}</span>
              {showRetry && (
                <button
                  type="button"
                  className="screen-retry"
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerUp={(event) => event.stopPropagation()}
                  onClick={onRetry}
                >
                  <RefreshCw />
                  重新请求画面
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="control-bar">
        <button onClick={() => onCommand("back")}><Undo2 /><span>返回</span></button>
        <button onClick={() => onCommand("home")}><Home /><span>主页</span></button>
        <button onClick={() => onCommand("recents")}><Square /><span>最近任务</span></button>
        <button onClick={() => onCommand("rotate")}><RotateCw /><span>旋转屏幕</span></button>
        <button onClick={() => onCommand("wakeScreen")}><Sun /><span>唤醒屏幕</span></button>
        <i />
        <button className="danger" onClick={onDisconnect}><LogOut /><span>断开连接</span></button>
      </div>
      {commandFeedback && <p className="privacy-note" role="status">{commandFeedback}</p>}
      <p className="privacy-note">为保障隐私，敏感页面可能无法显示或被系统限制操作。</p>
    </main>
  );
}
