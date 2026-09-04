import { readFile } from "node:fs/promises";
import type { CloudStatus, StoredSession } from "@photobooth/domain";

export class CloudflareUploadService {
  constructor(private readonly baseUrl?: string) {}

  getStatus(): CloudStatus {
    if (!this.baseUrl) return { mode: "unconfigured" };
    return { mode: "configured", baseUrl: this.baseUrl };
  }

  async publishSession(session: StoredSession, eventName: string): Promise<{ folderUrl: string }> {
    if (!this.baseUrl) throw new Error("Cloudflare upload belum dikonfigurasi");
    if (!session.finalStripPath) throw new Error("Strip final belum tersedia");

    const stripBase64 = (await readFile(session.finalStripPath)).toString("base64");
    const originals = await Promise.all(
      session.shots
        .filter((shot) => shot.filePath)
        .map(async (shot) => ({
          name: `photo-${String(shot.shotIndex + 1).padStart(2, "0")}.jpg`,
          base64: (await readFile(shot.filePath!, null)).toString("base64")
        }))
    );

    const response = await fetch(`${this.baseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sessionId: session.id,
        eventName,
        stripBase64,
        originals
      })
    });

    if (!response.ok) {
      throw new Error(`Cloudflare upload gagal: ${response.status}`);
    }

    return response.json() as Promise<{ folderUrl: string }>;
  }
}
