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
    const initResponse = await fetch(`${this.baseUrl}/api/sessions/init`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sessionId: session.id,
        eventName,
        recipientEmail: session.recipientEmail
      })
    });
    if (!initResponse.ok) throw new Error(`Cloudflare gagal membuat sesi: ${initResponse.status}`);

    const files: Array<{ name: string; path: string }> = [
      { name: "strip.jpg", path: session.finalStripPath }
    ];
    if (session.finalGifPath) files.push({ name: "slideshow.gif", path: session.finalGifPath });

    for (const file of files) {
      const bytes = await readFile(file.path);
      const uploadResponse = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(session.id)}/files/${file.name}`, {
        method: "PUT",
        headers: { "Content-Type": file.name.endsWith(".gif") ? "image/gif" : "image/jpeg" },
        body: new Uint8Array(bytes)
      });
      if (!uploadResponse.ok) throw new Error(`Cloudflare gagal upload ${file.name}: ${uploadResponse.status}`);
    }

    const completeResponse = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(session.id)}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ originals: [], gif: Boolean(session.finalGifPath) })
    });
    if (!completeResponse.ok) throw new Error(`Cloudflare gagal menyelesaikan sesi: ${completeResponse.status}`);
    return completeResponse.json() as Promise<{ folderUrl: string }>;
  }
}
