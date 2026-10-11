import type { Express } from "express";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { requireAuth } from "./auth.js";

interface AndroidRelease {
  version: string;
  versionCode: number;
  filename: string;
  size: number;
  sha256: string;
}

export function attachDownloads(app: Express) {
  const directory = path.resolve(process.env.APK_DIR ?? path.join(process.env.DATA_DIR ?? "data", "downloads"));
  async function release(): Promise<AndroidRelease> {
    const info = JSON.parse(await readFile(path.join(directory, "latest.json"), "utf8")) as AndroidRelease;
    if (!info || typeof info.version !== "string" || !/^\d+\.\d+\.\d+$/.test(info.version) ||
        info.filename !== `remote-control-agent-${info.version}.apk` ||
        !Number.isSafeInteger(info.versionCode) || info.versionCode < 1 ||
        !Number.isSafeInteger(info.size) || info.size < 1 ||
        typeof info.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(info.sha256)) {
      throw new Error("Invalid APK manifest");
    }
    const file = await stat(path.join(directory, info.filename));
    if (!file.isFile() || file.size !== info.size) throw new Error("APK missing or incomplete");
    return { version: info.version, versionCode: info.versionCode, filename: info.filename, size: info.size, sha256: info.sha256 };
  }
  app.get("/api/downloads/android", requireAuth, async (_req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    try { res.json(await release()); }
    catch { res.status(503).json({ message: "Android 安装包暂未发布，请稍后重试" }); }
  });
  app.get("/api/downloads/android/:filename", requireAuth, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const info = await release();
      if (req.params.filename !== info.filename) {
        res.status(404).json({ message: "安装包版本已更新，请刷新后下载" });
        return;
      }
      res.type("application/vnd.android.package-archive");
      res.download(path.join(directory, info.filename), info.filename, error => {
        if (error && !res.headersSent) res.status(503).json({ message: "安装包下载失败，请重试" });
      });
    } catch { res.status(503).json({ message: "Android 安装包暂未发布，请稍后重试" }); }
  });
}
