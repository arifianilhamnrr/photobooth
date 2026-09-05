import { Hono } from "hono";

type Bindings = {
  PHOTOBOOTH_BUCKET: R2Bucket;
  PHOTOBOOTH_DB: D1Database;
  PUBLIC_BASE_URL: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) => c.json({ ok: true }));

app.post("/api/sessions", async (c) => {
  const body = await c.req.json<{
    sessionId: string;
    eventName: string;
    recipientEmail?: string;
    stripBase64: string;
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
      JSON.stringify({ originals: body.originals.map((item) => item.name), email: { status: "pending_desktop_delivery" } })
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
  const imageUrl = stripObject ? `${c.env.PUBLIC_BASE_URL}/assets/${session.id}/strip.jpg` : "";

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
        p { color: #b2b4b3; line-height: 1.5; }
        a { color: #ff7048; }
        .download { display: inline-block; margin: 20px 0 8px; padding: 14px 20px; border-radius: 12px; background: #ff7048; color: #15110f; text-decoration: none; font-weight: 700; }
      </style>
    </head>
    <body>
      <main>
        <h1>Hasil photobooth kamu siap</h1>
        <p>${session.event_name} · ${session.id}</p>
        ${imageUrl ? `<img src="${imageUrl}" alt="Hasil strip photobooth" />` : "<p>Strip belum tersedia.</p>"}
        ${imageUrl ? `<a class="download" href="${c.env.PUBLIC_BASE_URL}/download/${session.id}/strip.jpg">Download foto</a>` : ""}
        ${session.recipient_email ? `<p>Link ini juga dikirim ke ${session.recipient_email}.</p>` : ""}
        <p>Gunakan tombol download untuk menyimpan hasil ke perangkatmu.</p>
      </main>
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
  headers.set("content-disposition", `attachment; filename="photobooth-${sessionId}.jpg"`);
  headers.set("cache-control", "private, max-age=0");
  return new Response(object.body, { headers });
});

export default app;
