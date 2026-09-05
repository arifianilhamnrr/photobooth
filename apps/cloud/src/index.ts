import { Hono } from "hono";
import QRCode from "qrcode";

type Bindings = {
  PHOTOBOOTH_BUCKET: R2Bucket;
  PHOTOBOOTH_DB: D1Database;
  PUBLIC_BASE_URL: string;
  PHOTOBOOTH_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();
const QRIS_PAYLOAD = "00020101021126610016ID.CO.SHOPEE.WWW01189360091800228194190208228194190303UMI51440014ID.CO.QRIS.WWW0215ID10264932277260303UMI5204581753033605802ID5904ArSr6011PURBALINGGA61055337262070703A01630428C9";
const SESSION_ID_PATTERN = /^SESI-[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/;

function secureEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

app.use("/api/*", async (c, next) => {
  const authorization = c.req.header("authorization") ?? "";
  const expected = `Bearer ${c.env.PHOTOBOOTH_API_KEY}`;
  if (!c.env.PHOTOBOOTH_API_KEY || !secureEqual(authorization, expected)) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

app.get("/health", (c) => c.json({ ok: true }));

app.get("/qris.svg", async (c) => {
  const svg = await QRCode.toString(QRIS_PAYLOAD, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 640,
    color: {
      dark: "#111315",
      light: "#ffffff"
    }
  });
  return c.body(svg, 200, {
    "content-type": "image/svg+xml; charset=utf-8",
    "cache-control": "public, max-age=86400"
  });
});

app.post("/api/sessions/init", async (c) => {
  const body = await c.req.json<{ sessionId: string; eventName: string; recipientEmail?: string }>();
  if (!SESSION_ID_PATTERN.test(body.sessionId) || typeof body.eventName !== "string" || body.eventName.length < 1 || body.eventName.length > 100) {
    return c.json({ error: "Invalid session" }, 400);
  }
  const createdAt = new Date().toISOString();
  const publicUrl = `${c.env.PUBLIC_BASE_URL}/s/${body.sessionId}`;
  await c.env.PHOTOBOOTH_DB.prepare(
    `INSERT INTO sessions (id, event_name, created_at, recipient_email, strip_key, strip_url, photo_count, status, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    body.sessionId,
    body.eventName,
    createdAt,
    body.recipientEmail ?? null,
    `sessions/${body.sessionId}/strip.jpg`,
    publicUrl,
    0,
    "uploading",
    JSON.stringify({ originals: [], gif: false })
  ).run().catch(() => undefined);
  const existing = await c.env.PHOTOBOOTH_DB.prepare("SELECT id FROM sessions WHERE id = ?").bind(body.sessionId).first();
  if (!existing) return c.json({ error: "Session initialization failed" }, 500);
  return c.json({ sessionId: body.sessionId, folderUrl: publicUrl });
});

app.put("/api/sessions/:sessionId/files/:fileName", async (c) => {
  const sessionId = c.req.param("sessionId");
  const fileName = c.req.param("fileName");
  if (!SESSION_ID_PATTERN.test(sessionId) || !/^(strip\.jpg|slideshow\.gif)$/.test(fileName)) {
    return c.json({ error: "Invalid file name" }, 400);
  }
  const contentLength = Number(c.req.header("content-length") ?? 0);
  const maxBytes = fileName.endsWith(".gif") ? 25 * 1024 * 1024 : 15 * 1024 * 1024;
  if (!contentLength || contentLength > maxBytes) return c.json({ error: "Invalid file size" }, 413);
  const session = await c.env.PHOTOBOOTH_DB.prepare("SELECT status FROM sessions WHERE id = ?").bind(sessionId).first<{ status: string }>();
  if (!session || session.status === "published") return c.json({ error: "Session cannot accept uploads" }, 409);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length !== contentLength || bytes.length > maxBytes) return c.json({ error: "Invalid file size" }, 413);
  const validSignature = fileName.endsWith(".gif")
    ? String.fromCharCode(...bytes.slice(0, 6)) === "GIF89a" || String.fromCharCode(...bytes.slice(0, 6)) === "GIF87a"
    : bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!validSignature) return c.json({ error: "Invalid media" }, 415);
  const contentType = fileName.endsWith(".gif") ? "image/gif" : "image/jpeg";
  await c.env.PHOTOBOOTH_BUCKET.put(`sessions/${sessionId}/${fileName}`, bytes, {
    httpMetadata: { contentType }
  });
  return c.json({ ok: true, fileName });
});

app.post("/api/sessions/:sessionId/complete", async (c) => {
  const sessionId = c.req.param("sessionId");
  if (!SESSION_ID_PATTERN.test(sessionId)) return c.json({ error: "Invalid session" }, 400);
  const body = await c.req.json<{ originals: string[]; gif: boolean }>();
  const [strip, gif] = await Promise.all([
    c.env.PHOTOBOOTH_BUCKET.head(`sessions/${sessionId}/strip.jpg`),
    c.env.PHOTOBOOTH_BUCKET.head(`sessions/${sessionId}/slideshow.gif`)
  ]);
  if (!strip || (body.gif && !gif)) return c.json({ error: "Media upload incomplete" }, 409);
  const updated = await c.env.PHOTOBOOTH_DB.prepare(
    "UPDATE sessions SET photo_count = ?, status = ?, metadata_json = ? WHERE id = ? AND status = 'uploading'"
  ).bind(
    body.originals.length,
    "published",
    JSON.stringify({ originals: body.originals, gif: body.gif, email: { status: "pending_desktop_delivery" } }),
    sessionId
  ).run();
  if (!updated.meta.changes) return c.json({ error: "Session cannot be completed" }, 409);
  return c.json({ sessionId, folderUrl: `${c.env.PUBLIC_BASE_URL}/s/${sessionId}` });
});

app.get("/s/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = await c.env.PHOTOBOOTH_DB.prepare(
    "SELECT id, event_name, created_at, recipient_email, strip_key, strip_url, photo_count, status, metadata_json FROM sessions WHERE id = ?"
  )
    .bind(sessionId)
    .first<{
      id: string;
      event_name: string;
      created_at: string;
      recipient_email: string | null;
      strip_key: string;
      strip_url: string;
      photo_count: number;
      status: string;
      metadata_json: string | null;
    }>();

  if (!session || session.status !== "published" || !SESSION_ID_PATTERN.test(sessionId)) return c.notFound();

  const stripObject = await c.env.PHOTOBOOTH_BUCKET.get(session.strip_key);
  const gifObject = await c.env.PHOTOBOOTH_BUCKET.get(`sessions/${session.id}/slideshow.gif`);
  const imageUrl = stripObject ? `${c.env.PUBLIC_BASE_URL}/assets/${session.id}/strip.jpg` : "";
  const gifUrl = gifObject ? `${c.env.PUBLIC_BASE_URL}/assets/${session.id}/slideshow.gif` : "";

  const safeId = escapeHtml(session.id);
  const safeEventName = escapeHtml(session.event_name);
  return c.html(`<!doctype html>
  <html lang="id">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Photobooth ${safeId}</title>
      <style>
        body { margin: 0; font-family: Arial, sans-serif; background: #111315; color: #f2f1ed; display: grid; place-items: center; min-height: 100vh; }
        main { width: min(92vw, 560px); text-align: center; }
        img { width: 100%; border-radius: 24px; box-shadow: 0 24px 80px rgba(0,0,0,.35); }
        .gif { margin-top: 28px; aspect-ratio: 16/9; object-fit: cover; }
        .actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin: 20px 0 8px; }
        p { color: #b2b4b3; line-height: 1.5; }
        a { color: #ff7048; }
        .download { display: inline-block; padding: 14px 20px; border-radius: 12px; background: #ff7048; color: #15110f; text-decoration: none; font-weight: 700; }
        .download.secondary { background: #2b2f33; color: #f2f1ed; }
        dialog { width: min(92vw, 440px); max-height: calc(100dvh - 24px); padding: 0; overflow: hidden; border: 1px solid #34383c; border-radius: 22px; background: #181a1c; color: #f2f1ed; box-shadow: 0 30px 100px rgba(0,0,0,.48); }
        dialog::backdrop { background: rgba(8,9,10,.76); backdrop-filter: blur(6px); }
        .donation { position: relative; padding: clamp(18px, 3.5vh, 24px); text-align: center; }
        .donation h2 { margin: 0; padding: 0 32px; font-size: clamp(22px, 4vh, 28px); }
        .donation p { margin: clamp(6px, 1.4vh, 10px) auto clamp(10px, 2vh, 18px); max-width: 36ch; font-size: clamp(13px, 2.1vh, 16px); }
        .qris { width: min(70vw, 300px, 42vh); margin: 0 auto; padding: clamp(6px, 1.2vh, 10px); border-radius: 16px; background: white; box-shadow: none; }
        .donation-actions { display: grid; margin-top: clamp(10px, 2vh, 20px); }
        .donation-actions button { min-height: 48px; padding: 0 14px; border: 0; border-radius: 12px; font: inherit; font-weight: 700; cursor: pointer; }
        .continue-download { background: #ff7048; color: #15110f; }
        .donation-note { display: block; margin-top: clamp(6px, 1.4vh, 12px); color: #83898d; font-size: clamp(10px, 1.7vh, 12px); }
        .dialog-close { position: absolute; top: 12px; right: 12px; z-index: 1; width: 36px; height: 36px; padding: 0; border: 1px solid #41464b; border-radius: 50%; background: #25282b; color: #f2f1ed; font: inherit; font-size: 22px; line-height: 1; cursor: pointer; }
        .dialog-close:hover { background: #34383c; }
        @media (max-height: 620px) {
          dialog { width: min(88vw, 390px); }
          .donation-actions button { min-height: 42px; }
        }
      </style>
    </head>
    <body>
      <main>
        <h1>Hasil photobooth kamu siap</h1>
        <p>${safeEventName} · ${safeId}</p>
        ${imageUrl ? `<img src="${imageUrl}" alt="Hasil strip photobooth" />` : "<p>Strip belum tersedia.</p>"}
        ${gifUrl ? `<img class="gif" src="${gifUrl}" alt="GIF animasi enam foto photobooth" />` : ""}
        <div class="actions">
          ${imageUrl ? `<a class="download donation-download" href="${c.env.PUBLIC_BASE_URL}/download/${session.id}/strip.jpg">Download foto</a>` : ""}
          ${gifUrl ? `<a class="download secondary donation-download" href="${c.env.PUBLIC_BASE_URL}/download/${session.id}/slideshow.gif">Download GIF</a>` : ""}
        </div>
        <p>Gunakan tombol download untuk menyimpan hasil ke perangkatmu.</p>
      </main>
      <dialog id="donation-dialog" aria-labelledby="donation-title">
        <div class="donation">
          <button class="dialog-close" type="button" aria-label="Tutup popup">&times;</button>
          <h2 id="donation-title">Dukung photobooth ini</h2>
          <p>Kalau berkenan, kamu bisa berdonasi seikhlasnya lewat QRIS. Download tetap gratis.</p>
          <img class="qris" src="${c.env.PUBLIC_BASE_URL}/qris.svg" alt="QRIS donasi seikhlasnya" />
          <div class="donation-actions">
            <button class="continue-download" type="button">Download</button>
          </div>
          <small class="donation-note">Tidak ada nominal minimum dan tidak ada verifikasi pembayaran.</small>
        </div>
      </dialog>
      <script>
        const dialog = document.getElementById('donation-dialog');
        let pendingDownload = '';
        document.querySelectorAll('.donation-download').forEach((link) => {
          link.addEventListener('click', (event) => {
            event.preventDefault();
            pendingDownload = link.href;
            dialog.showModal();
          });
        });
        function continueDownload() {
          const url = pendingDownload;
          pendingDownload = '';
          dialog.close();
          if (url) window.location.href = url;
        }
        dialog.querySelector('.continue-download').addEventListener('click', continueDownload);
        dialog.querySelector('.dialog-close').addEventListener('click', () => {
          pendingDownload = '';
          dialog.close();
        });
        dialog.addEventListener('click', (event) => {
          if (event.target === dialog) {
            pendingDownload = '';
            dialog.close();
          }
        });
      </script>
    </body>
  </html>`);
});

app.get("/assets/:sessionId/:fileName", async (c) => {
  const sessionId = c.req.param("sessionId");
  const fileName = c.req.param("fileName");
  if (!SESSION_ID_PATTERN.test(sessionId) || !/^(strip\.jpg|slideshow\.gif)$/.test(fileName)) return c.notFound();
  const published = await c.env.PHOTOBOOTH_DB.prepare("SELECT id FROM sessions WHERE id = ? AND status = 'published'").bind(sessionId).first();
  if (!published) return c.notFound();
  const object = await c.env.PHOTOBOOTH_BUCKET.get(`sessions/${sessionId}/${fileName}`);
  if (!object) return c.notFound();
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", "public, max-age=3600");
  return new Response(object.body, { headers });
});

app.get("/download/:sessionId/:fileName", async (c) => {
  const sessionId = c.req.param("sessionId");
  const fileName = c.req.param("fileName");
  if (!SESSION_ID_PATTERN.test(sessionId) || !/^(strip\.jpg|slideshow\.gif)$/.test(fileName)) return c.notFound();
  const published = await c.env.PHOTOBOOTH_DB.prepare("SELECT id FROM sessions WHERE id = ? AND status = 'published'").bind(sessionId).first();
  if (!published) return c.notFound();
  const object = await c.env.PHOTOBOOTH_BUCKET.get(`sessions/${sessionId}/${fileName}`);
  if (!object) return c.notFound();
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  const extension = fileName.endsWith(".gif") ? "gif" : "jpg";
  const label = extension === "gif" ? "photobooth-gif" : "photobooth";
  headers.set("content-disposition", `attachment; filename="${label}-${sessionId}.${extension}"`);
  headers.set("cache-control", "private, max-age=0");
  return new Response(object.body, { headers });
});

export default app;
