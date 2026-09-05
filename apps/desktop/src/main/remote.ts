import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { networkInterfaces } from "node:os";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BrowserWindow } from "electron";
import type { RemoteSessionState, RemoteStatus } from "@photobooth/domain";

const execFileAsync = promisify(execFile);
const PORT = 8788;

type RemoteCommand = "start" | "accept" | "retake";

export class RemoteControlServer {
  private server = createServer((request, response) => void this.handle(request, response));
  private enabled = false;
  private pairingToken = "";
  private controllerKey = "";
  private paired = false;
  private preview?: Buffer;
  private stripPath?: string;
  private gifPath?: string;
  private hotspot?: { ssid: string; password: string };
  private state: RemoteSessionState = {
    phase: "idle",
    shotIndex: 0,
    totalShots: 6,
    cameraReady: false,
    stripReady: false,
    gifReady: false
  };

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  async start(): Promise<void> {
    if (this.server.listening) return;
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(PORT, "0.0.0.0", () => resolve());
    });
  }

  async enable(): Promise<RemoteStatus> {
    await this.start();
    this.enabled = true;
    this.paired = false;
    this.pairingToken = randomBytes(18).toString("base64url");
    this.controllerKey = randomBytes(24).toString("base64url");
    if (!this.getLanAddress() && process.platform === "linux") await this.startHotspot();
    return this.getStatus();
  }

  disable(): RemoteStatus {
    this.enabled = false;
    this.paired = false;
    this.preview = undefined;
    return this.getStatus();
  }

  async enableHotspot(): Promise<RemoteStatus> {
    if (process.platform === "linux") await this.startHotspot(true);
    return this.getStatus();
  }

  async disableHotspot(): Promise<RemoteStatus> {
    if (process.platform === "linux" && this.hotspot) {
      await execFileAsync("nmcli", ["connection", "down", "Photobooth-Remote"]).catch(() => undefined);
      this.hotspot = undefined;
    }
    return this.getStatus();
  }

  getStatus(): RemoteStatus {
    const address = this.getLanAddress();
    const baseUrl = address ? `http://${address}:${PORT}` : undefined;
    return {
      enabled: this.enabled,
      paired: this.paired,
      baseUrl,
      pairingUrl: this.enabled && baseUrl ? `${baseUrl}/pair?t=${encodeURIComponent(this.pairingToken)}` : undefined,
      networkMode: this.hotspot ? "hotspot" : address ? "lan" : "unavailable",
      ssid: this.hotspot?.ssid,
      wifiPassword: this.hotspot?.password
    };
  }

  updateState(state: RemoteSessionState & { stripPath?: string; gifPath?: string }): void {
    const { stripPath, gifPath, ...publicState } = state;
    this.state = publicState;
    this.stripPath = stripPath;
    this.gifPath = gifPath;
  }

  updatePreview(dataUrl?: string): void {
    if (!dataUrl) return;
    const match = dataUrl.match(/^data:image\/(?:jpeg|jpg);base64,(.+)$/);
    if (match) this.preview = Buffer.from(match[1], "base64");
  }

  private getLanAddress(): string | undefined {
    for (const [name, addresses] of Object.entries(networkInterfaces())) {
      if (/^(lo|docker|veth|zt)/.test(name)) continue;
      const address = addresses?.find((item) => item.family === "IPv4" && !item.internal);
      if (address) return address.address;
    }
    return undefined;
  }

  private async startHotspot(force = false): Promise<void> {
    const ssid = "Photobooth-Remote";
    const password = `PB-${Math.floor(100000 + Math.random() * 900000)}`;
    try {
      const { stdout } = await execFileAsync("nmcli", ["-t", "-f", "DEVICE,TYPE,STATE", "device"]);
      const wifi = stdout.split("\n").map((line) => line.split(":"))
        .find(([, type, state]) => type === "wifi" && state !== "unavailable");
      if (!wifi?.[0]) return;
      if (force) await execFileAsync("nmcli", ["device", "disconnect", wifi[0]]).catch(() => undefined);
      await execFileAsync("nmcli", ["device", "wifi", "hotspot", "ifname", wifi[0], "con-name", "Photobooth-Remote", "ssid", ssid, "password", password]);
      this.hotspot = { ssid, password };
    } catch {
      this.hotspot = undefined;
    }
  }

  private isAuthorized(request: IncomingMessage): boolean {
    const url = new URL(request.url ?? "/", "http://localhost");
    const key = url.searchParams.get("key") ?? "";
    const expected = Buffer.from(this.controllerKey);
    const actual = Buffer.from(key);
    return this.enabled && expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/pair") {
      if (!this.enabled || url.searchParams.get("t") !== this.pairingToken || this.paired) return this.text(response, 403, "Pairing tidak valid atau sudah dipakai.");
      this.paired = true;
      this.pairingToken = "";
      response.writeHead(302, { location: `/?key=${encodeURIComponent(this.controllerKey)}`, "cache-control": "no-store" });
      response.end();
      return;
    }
    if (!this.isAuthorized(request)) return this.text(response, 401, "Remote belum dipasangkan.");
    if (url.pathname === "/") return this.html(response, this.remotePage());
    if (url.pathname === "/api/state") return this.json(response, 200, this.state);
    if (url.pathname === "/api/preview") {
      if (!this.preview) return this.text(response, 404, "Preview belum tersedia.");
      response.writeHead(200, { "content-type": "image/jpeg", "content-length": this.preview.length, "cache-control": "no-store" });
      response.end(this.preview);
      return;
    }
    if (url.pathname.startsWith("/api/command/") && request.method === "POST") {
      const command = url.pathname.split("/").at(-1) as RemoteCommand;
      if (!(["start", "accept", "retake"] as string[]).includes(command)) return this.json(response, 400, { error: "Command tidak valid" });
      this.getWindow()?.webContents.send("remote:command", command);
      return this.json(response, 202, { ok: true });
    }
    if (url.pathname === "/download/strip" && this.stripPath) return this.file(response, this.stripPath, "image/jpeg", "photobooth-strip.jpg");
    if (url.pathname === "/download/gif" && this.gifPath) return this.file(response, this.gifPath, "image/gif", "photobooth.gif");
    return this.text(response, 404, "Tidak ditemukan.");
  }

  private async file(response: ServerResponse, path: string, contentType: string, name: string): Promise<void> {
    try {
      const bytes = await readFile(path);
      response.writeHead(200, { "content-type": contentType, "content-length": bytes.length, "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" });
      response.end(bytes);
    } catch {
      this.text(response, 404, "File belum tersedia.");
    }
  }

  private remotePage(): string {
    return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Photobooth Remote</title><style>
      :root{font-family:Arial,sans-serif;color:#f2f1ed;background:#101112}*{box-sizing:border-box}body{margin:0;min-height:100dvh;background:#101112}main{min-height:100dvh;display:grid;grid-template-rows:auto 1fr auto;gap:14px;padding:18px}.top{display:flex;justify-content:space-between;align-items:center}.top strong{font-size:18px}.status{color:#aeb4b7;font-size:13px}.preview{position:relative;min-height:0;border:1px solid #34383c;border-radius:22px;overflow:hidden;background:#1b1e20}.preview img{width:100%;height:100%;object-fit:cover;display:block}.badge{position:absolute;left:12px;bottom:12px;padding:8px 11px;border-radius:999px;background:rgba(10,11,12,.76);font-size:12px}.panel{display:grid;gap:12px}.progress{display:flex;justify-content:space-between;color:#aeb4b7;font-size:14px}.actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}.actions.single{grid-template-columns:1fr}button,a{min-height:54px;border:0;border-radius:14px;font:inherit;font-weight:700;display:grid;place-items:center;text-decoration:none;cursor:pointer}.primary{background:#ff7048;color:#15110f}.secondary{background:#292d30;color:#f2f1ed}.downloads{display:none;grid-template-columns:1fr 1fr;gap:10px}.countdown{font-size:72px;font-weight:800;text-align:center}.hidden{display:none!important}@media(min-width:700px){main{max-width:640px;margin:auto}}
    </style></head><body><main><div class="top"><strong>Photobooth Remote</strong><span class="status" id="status">Menghubungkan...</span></div><div class="preview"><img id="preview" alt="Preview kamera"><span class="badge" id="badge">Siap</span></div><div class="panel"><div class="progress"><span id="phase">Idle</span><span id="shot">Foto 1 dari 6</span></div><div class="countdown hidden" id="countdown"></div><div class="actions single" id="start-actions"><button class="primary" data-command="start">Mulai</button></div><div class="actions hidden" id="review-actions"><button class="secondary" data-command="retake">Ulang</button><button class="primary" data-command="accept">Next</button></div><div class="downloads" id="downloads"><a class="primary" id="strip-link">Download Foto</a><a class="secondary" id="gif-link">Download GIF</a></div></div></main><script>
      const key=new URLSearchParams(location.search).get('key');const q=(p)=>p+'?key='+encodeURIComponent(key);const preview=document.getElementById('preview');const status=document.getElementById('status');const phase=document.getElementById('phase');const shot=document.getElementById('shot');const badge=document.getElementById('badge');const countdown=document.getElementById('countdown');const startActions=document.getElementById('start-actions');const reviewActions=document.getElementById('review-actions');const downloads=document.getElementById('downloads');const stripLink=document.getElementById('strip-link');const gifLink=document.getElementById('gif-link');
      document.querySelectorAll('[data-command]').forEach(button=>button.onclick=()=>fetch(q('/api/command/'+button.dataset.command),{method:'POST'}));
      async function update(){try{const r=await fetch(q('/api/state'),{cache:'no-store'});const s=await r.json();status.textContent=s.cameraReady?'Kamera siap':'Menunggu kamera';phase.textContent=s.phase;shot.textContent='Foto '+(s.shotIndex+1)+' dari '+s.totalShots;badge.textContent=s.phase==='shot-review'?'Cek hasil foto':'Live preview';countdown.textContent=s.countdown??'';countdown.classList.toggle('hidden',s.phase!=='countdown');startActions.classList.toggle('hidden',!['ready','pose-ready'].includes(s.phase));reviewActions.classList.toggle('hidden',s.phase!=='shot-review');downloads.style.display=s.stripReady?'grid':'none';stripLink.href=q('/download/strip');gifLink.href=q('/download/gif');}catch{status.textContent='Koneksi terputus'}}
      setInterval(update,350);setInterval(()=>{preview.src=q('/api/preview')+'&v='+Date.now()},250);update();
    </script></body></html>`;
  }

  private text(response: ServerResponse, status: number, value: string): void { response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }); response.end(value); }
  private html(response: ServerResponse, value: string): void { response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); response.end(value); }
  private json(response: ServerResponse, status: number, value: unknown): void { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(value)); }
}
