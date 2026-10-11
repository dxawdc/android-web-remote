import { useEffect, useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { api, type AndroidRelease } from "../lib/api";

export function AndroidDownload({ token }: { token: string }) {
  const [release, setRelease] = useState<AndroidRelease>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    api.androidRelease(token).then(info => { if (current) setRelease(info); })
      .catch((e: Error) => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [token]);
  const download = async () => {
    setBusy(true);
    setError("");
    try {
      const info = await api.androidRelease(token);
      setRelease(info);
      const blob = await api.downloadAndroid(token, info.filename);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = info.filename;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="android-download">
    <button type="button" onClick={download} disabled={busy}>
      {busy ? <LoaderCircle size={16} /> : <Download size={16} />}
      {busy ? "正在下载…" : "下载 Android APK"}
      {release && <small>v{release.version}</small>}
    </button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
