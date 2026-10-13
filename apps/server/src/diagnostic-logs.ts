import fs from "node:fs";
import path from "node:path";

export interface DiagnosticSnapshot {
  receivedAt: string;
  version: string;
  lines: string[];
}

// One bounded snapshot per registered device, outside public static files.
export class DiagnosticLogStore {
  constructor(private readonly directory = path.join(process.env.DATA_DIR ?? path.join(process.cwd(), "data"), "diagnostic-logs")) {}

  private filename(id: number) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid device id");
    return path.join(this.directory, `${id}.json`);
  }

  read(id: number): DiagnosticSnapshot | null {
    try { return JSON.parse(fs.readFileSync(this.filename(id), "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  save(id: number, message: Record<string, unknown>): boolean {
    if (typeof message.version !== "string" || !/^\d+\.\d+\.\d+$/.test(message.version) || message.version.length > 32 ||
        typeof message.uploadId !== "string" || !/^[\w:-]{1,80}$/.test(message.uploadId) ||
        !Array.isArray(message.lines) || message.lines.length > 300 ||
        !message.lines.every(line => typeof line === "string" && line.length <= 600 && !/[\r\n\x00]/.test(line))) return false;
    const previous = this.read(id);
    if (previous && Date.now() - Date.parse(previous.receivedAt) < 5_000) return false;
    const snapshot: DiagnosticSnapshot = { receivedAt: new Date().toISOString(), version: message.version, lines: message.lines };
    const target = this.filename(id);
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(snapshot), { mode: 0o600 });
    fs.renameSync(`${target}.tmp`, target);
    return true;
  }

  remove(id: number) { fs.rmSync(this.filename(id), { force: true }); }
}
