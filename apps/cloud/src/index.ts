import { Hono } from "hono";
import QRCode from "qrcode";

type Bindings = {
  PHOTOBOOTH_BUCKET: R2Bucket;
  PHOTOBOOTH_DB: D1Database;
  PUBLIC_BASE_URL: string;
};

const app = new Hono<{ Bindings: Bindings }>();
const QRIS_PAYLOAD = "00020101021126610016ID.CO.SHOPEE.WWW01189360091800228194190208228194190303UMI51440014ID.CO.QRIS.WWW0215ID10264932277260303UMI5204581753033605802ID5904ArSr6011PURBALINGGA61055337262070703A01630428C9";

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
  const createdAt = new Date().toISOString();
  const publicUrl = `${c.env.PUBLIC_BASE_URL}/s/${body.sessionId}`;
  await c.env.PHOTOBOOTH_DB.prepare(
    `INSERT OR REPLACE INTO sessions (id, event_name, created_at, recipient_email, strip_key, strip_url, photo_count, status, metadata_json)
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
  ).run();
  return c.json({ sessionId: body.sessionId, folderUrl: publicUrl });
});

app.put("/api/sessions/:sessionId/files/:fileName", async (c) => {
  const sessionId = c.req.param("sessionId");
  const fileName = c.req.param("fileName");
  if (!/^(strip\.jpg|slideshow\.gif|photo-\d{2}\.jpg)$/.test(fileName)) {
    return c.json({ error: "Invalid file name" }, 400);
  }
  if (!c.req.raw.body) return c.json({ error: "Missing file body" }, 400);
  const contentType = fileName.endsWith(".gif") ? "image/gif" : "image/jpeg";
  await c.env.PHOTOBOOTH_BUCKET.put(`sessions/${sessionId}/${fileName}`, c.req.raw.body, {
    httpMetadata: { contentType }
  });
  return c.json({ ok: true, fileName });
});

app.post("/api/sessions/:sessionId/complete", async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json<{ originals: string[]; gif: boolean }>();
  await c.env.PHOTOBOOTH_DB.prepare(
    "UPDATE sessions SET photo_count = ?, status = ?, metadata_json = ? WHERE id = ?"
  ).bind(
    body.originals.length,
    "published",
    JSON.stringify({ originals: body.originals, gif: body.gif, email: { status: "pending_desktop_delivery" } }),
    sessionId
  ).run();
  return c.json({ sessionId, folderUrl: `${c.env.PUBLIC_BASE_URL}/s/${sessionId}` });
});

app.post("/api/sessions", async (c) => {
  const body = await c.req.json<{
    sessionId: string;
    eventName: string;
    recipientEmail?: string;
    stripBase64: string;
    gifBase64?: string;
    originals: Array<{ name: string; base64: string }>;
  }>();

  const createdAt = new Date().toISOString();
  const folderPrefix = `sessions/${body.sessionId}`;
  const stripKey = `${folderPrefix}/strip.jpg`;

  await c.env.PHOTOBOOTH_BUCKET.put(stripKey, Uint8Array.from(atob(body.stripBase64), (char) => char.charCodeAt(0)), {
    httpMetadata: {
      contentType: "image/jpeg"
    }
  });

  if (body.gifBase64) {
    await c.env.PHOTOBOOTH_BUCKET.put(`${folderPrefix}/slideshow.gif`, Uint8Array.from(atob(body.gifBase64), (char) => char.charCodeAt(0)), {
      httpMetadata: {
        contentType: "image/gif"
      }
    });
  }

  for (const original of body.originals) {
    await c.env.PHOTOBOOTH_BUCKET.put(`${folderPrefix}/${original.name}`, Uint8Array.from(atob(original.base64), (char) => char.charCodeAt(0)), {
      httpMetadata: {
        contentType: "image/jpeg"
      }
    });
  }

  const publicUrl = `${c.env.PUBLIC_BASE_URL}/s/${body.sessionId}`;

  await c.env.PHOTOBOOTH_DB.prepare(
    `INSERT OR REPLACE INTO sessions (id, event_name, created_at, recipient_email, strip_key, strip_url, photo_count, status, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.sessionId,
      body.eventName,
      createdAt,
      body.recipientEmail ?? null,
      stripKey,
      publicUrl,
      body.originals.length,
      "published",
      JSON.stringify({ originals: body.originals.map((item) => item.name), gif: Boolean(body.gifBase64), email: { status: "pending_desktop_delivery" } })
    )
    .run();

  return c.json({
    sessionId: body.sessionId,
    folderUrl: publicUrl
  });
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

  if (!session) return c.notFound();

  const stripObject = await c.env.PHOTOBOOTH_BUCKET.get(session.strip_key);
  const gifObject = await c.env.PHOTOBOOTH_BUCKET.get(`sessions/${session.id}/slideshow.gif`);
  const imageUrl = stripObject ? `${c.env.PUBLIC_BASE_URL}/assets/${session.id}/strip.jpg` : "";
  const gifUrl = gifObject ? `${c.env.PUBLIC_BASE_URL}/assets/${session.id}/slideshow.gif` : "";

  return c.html(`<!doctype html>
  <html lang="id">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Photobooth ${session.id}</title>
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
        dialog { width: min(92vw, 440px); padding: 0; border: 1px solid #34383c; border-radius: 22px; background: #181a1c; color: #f2f1ed; box-shadow: 0 30px 100px rgba(0,0,0,.48); }
        dialog::backdrop { background: rgba(8,9,10,.76); backdrop-filter: blur(6px); }
        .donation { padding: 24px; text-align: center; }
        .donation h2 { margin: 0; font-size: 28px; }
        .donation p { margin: 10px auto 18px; max-width: 36ch; }
        .qris { width: min(76vw, 300px); margin: 0 auto; padding: 10px; border-radius: 16px; background: white; box-shadow: none; }
        .donation-actions { display: grid; margin-top: 20px; }
        .donation-actions button { min-height: 48px; padding: 0 14px; border: 0; border-radius: 12px; font: inherit; font-weight: 700; cursor: pointer; }
        .continue-download { background: #ff7048; color: #15110f; }
        .donation-note { display: block; margin-top: 12px; color: #83898d; font-size: 12px; }
      </style>
    </head>
    <body>
      <main>
        <h1>Hasil photobooth kamu siap</h1>
        <p>${session.event_name} · ${session.id}</p>
        ${imageUrl ? `<img src="${imageUrl}" alt="Hasil strip photobooth" />` : "<p>Strip belum tersedia.</p>"}
        ${gifUrl ? `<img class="gif" src="${gifUrl}" alt="GIF animasi enam foto photobooth" />` : ""}
        <div class="actions">
          ${imageUrl ? `<a class="download donation-download" href="${c.env.PUBLIC_BASE_URL}/download/${session.id}/strip.jpg">Download foto</a>` : ""}
          ${gifUrl ? `<a class="download secondary donation-download" href="${c.env.PUBLIC_BASE_URL}/download/${session.id}/slideshow.gif">Download GIF</a>` : ""}
        </div>
        ${session.recipient_email ? `<p>Link ini juga dikirim ke ${session.recipient_email}.</p>` : ""}
        <p>Gunakan tombol download untuk menyimpan hasil ke perangkatmu.</p>
      </main>
      <dialog id="donation-dialog" aria-labelledby="donation-title">
        <div class="donation">
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
        dialog.addEventListener('click', (event) => {
          if (event.target === dialog) dialog.close();
        });
      </script>
    </body>
  </html>`);
});

app.get("/assets/:sessionId/:fileName", async (c) => {
  const sessionId = c.req.param("sessionId");
  const fileName = c.req.param("fileName");
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
