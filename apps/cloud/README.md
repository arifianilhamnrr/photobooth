# Cloud Backend

Backend ini berjalan di Cloudflare Worker dengan:

- Route target: `photobooth.collaborationday2026.web.id/*`
- R2 bucket: `photobooth-collaborationday2026`
- D1 database: `photobooth-cloud`

## Status Saat Ini

- Worker sudah berhasil dideploy ke Cloudflare account `d63ada033477b8f094345bda9dd0487f`.
- Route Worker untuk `photobooth.collaborationday2026.web.id/*` sudah terpasang.
- D1 schema `sessions` sudah dibuat di remote database.
- Desktop app memprioritaskan publish ke `https://photobooth.collaborationday2026.web.id`.

## Catatan DNS

Jika domain custom belum resolve publik, cek bahwa DNS record/route subdomain `photobooth` memang aktif di zone Cloudflare dan sudah propagasi.

## Commands

```bash
npm run deploy -w @photobooth/cloud
npm run db:migrate:remote -w @photobooth/cloud
```
