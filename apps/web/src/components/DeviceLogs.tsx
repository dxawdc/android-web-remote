import { useEffect, useState } from "react";
import { api, type DiagnosticSnapshot } from "../lib/api";

export function DeviceLogs({ token, device, onClose }: {
  token: string; device: { id: number; name: string }; onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const result = await api.deviceLogs(token, device.id);
        if (active) { setSnapshot(result.snapshot); setError(""); }
      } catch (cause) { if (active) setError((cause as Error).message); }
      finally { if (active) setLoading(false); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [token, device.id]);

  return <section className="device-logs" aria-label={`${device.name}的日志`}>
    <div className="diagnostics-heading"><h3>{device.name} · 手机日志</h3><button onClick={onClose}>关闭日志</button></div>
    <p>手机认证连通后自动同步，离线时显示服务器最后保存的记录。仅保留最近 300 条，每 10 秒刷新。</p>
    {error && <p role="alert">读取失败：{error}</p>}
    {loading ? <p>正在读取日志…</p> : snapshot ? <>
      <p>服务器接收时间：{new Date(snapshot.receivedAt).toLocaleString("zh-CN")} · Agent v{snapshot.version}</p>
      <textarea aria-label="手机诊断日志" readOnly value={snapshot.lines.join("\n")} spellCheck={false}/>
    </> : !error && <p>尚未收到日志。请安装 v0.9.0 或更高版本，并保持无障碍服务开启、设备认证成功。</p>}
  </section>;
}
