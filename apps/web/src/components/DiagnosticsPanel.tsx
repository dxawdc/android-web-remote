import { Activity, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type DeviceDiagnostic } from "../lib/api";

const absoluteTime = (value: string | null) => {
  if (!value) return "暂无";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
};

const relativeTime = (value: string | null, reference: number) => {
  if (!value) return "从未";
  const seconds = Math.max(0, Math.floor((reference - new Date(value).getTime()) / 1000));
  if (seconds < 5) return "刚刚";
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
};

export function DiagnosticsPanel({ token }: { token: string }) {
  const [devices, setDevices] = useState<DeviceDiagnostic[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const now = generatedAt ? new Date(generatedAt).getTime() : Date.now();

  const reload = useCallback(async () => {
    try {
      const result = await api.diagnostics(token);
      setDevices(result.devices);
      setGeneratedAt(result.generatedAt);
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), 2_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  return (
    <section className="diagnostics-panel">
      <div className="diagnostics-heading">
        <div>
          <h2>设备实时诊断</h2>
          <p>查看设备链路、首帧和截图任务状态，数据每 2 秒自动刷新。</p>
        </div>
        <div className="diagnostics-actions">
          <span className="live-badge"><i />实时</span>
          <button className="icon-button" title="立即刷新" onClick={() => void reload()}>
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {error && <div className="diagnostic-error-banner">刷新失败：{error}</div>}
      {loading && <div className="diagnostics-empty">正在读取设备状态…</div>}
      {!loading && devices.length === 0 && (
        <div className="diagnostics-empty">
          <Activity size={28} />
          <strong>还没有远程设备</strong>
          <span>账号添加设备后会显示在这里。</span>
        </div>
      )}
      {devices.length > 0 && (
        <div className="diagnostics-table">
          <div className="diagnostics-row diagnostics-head">
            <span>设备</span>
            <span>账号</span>
            <span>连接状态</span>
            <span>连接时间</span>
            <span>最后一帧</span>
            <span>截图错误</span>
            <span>控制端</span>
          </div>
          {devices.map((device) => {
            const lastError = device.session.lastCaptureError;
            return (
              <div className="diagnostics-row" key={device.id}>
                <span className="diagnostic-device" data-label="设备">
                  <strong>{device.name}</strong>
                  <small>{device.device_id}</small>
                </span>
                <span data-label="账号">{device.owner_username}</span>
                <span data-label="连接状态">
                  <b className={`status-pill ${device.session.online ? "is-online" : "is-offline"}`}>
                    {device.session.online ? "在线" : "离线"}
                  </b>
                </span>
                <span data-label="连接时间" title={absoluteTime(device.session.connectedAt)}>
                  {relativeTime(device.session.connectedAt, now)}
                </span>
                <span data-label="最后一帧" title={absoluteTime(device.session.lastFrameAt)}>
                  {relativeTime(device.session.lastFrameAt, now)}
                </span>
                <span className={lastError ? "diagnostic-capture-error" : ""} data-label="截图错误">
                  {lastError
                    ? <><strong>{String(lastError.code)} · {lastError.reason ?? "未知原因"}</strong><small>{relativeTime(lastError.at, now)}</small></>
                    : "无"}
                </span>
                <span data-label="控制端"><strong>{device.session.controllerCount}</strong> 个</span>
              </div>
            );
          })}
        </div>
      )}
      {generatedAt && (
        <p className="diagnostics-updated">最近更新：{absoluteTime(generatedAt)}</p>
      )}
    </section>
  );
}
