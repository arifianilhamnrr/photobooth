# Collaboration Day Photobooth

Desktop photobooth offline-first untuk event `Collaboration Day 2026`.

Fitur utama:

- Berjalan di Linux dan disiapkan untuk Windows.
- Mendukung webcam browser dan Canon EOS tethered via `gphoto2`.
- Template strip berbasis PNG transparan.
- Retake per foto.
- Simpan file lokal per sesi.
- Upload hasil ke Cloudflare Worker + R2 + D1.
- QR code ke link hasil publik.
- Input email di akhir flow.
- Kirim link hasil via Brevo SMTP.

## Status Saat Ini

Yang sudah berjalan end-to-end:

- Capture webcam.
- Capture Canon EOS still photo di Linux.
- Render strip final ke file lokal.
- Upload ke `photobooth.collaborationday2026.web.id`.
- Link publik hasil di Cloudflare.
- Kirim email hasil lewat Brevo SMTP.
- Package Linux `.AppImage` dan `.deb`.

## Struktur Repo

```text
apps/desktop/   Electron desktop app
apps/cloud/     Cloudflare Worker + D1 + R2 backend
packages/       Shared logic untuk domain, storage, compositor, drive
ARCHITECTURE.md Dokumentasi arsitektur
DESIGN.md       Dokumentasi flow dan UI
```

## Requirement

- Node.js 20+
- npm
- Linux: `gphoto2` untuk Canon EOS tethered
- Akun Cloudflare dengan zone `collaborationday2026.web.id`
- Akun Brevo dengan SMTP credential aktif

## Environment

### Desktop App

Set env ini sebelum menjalankan app desktop:

```bash
export PHOTOBOOTH_CLOUD_URL="https://photobooth.collaborationday2026.web.id"
export BREVO_API_KEY="<smtp-password-brevo>"
export BREVO_SMTP_LOGIN="ab3ed4001@smtp-brevo.com"
export BREVO_SENDER_EMAIL="noreply@collaborationday2026.web.id"
export BREVO_SENDER_NAME="Collaboration Day 2026 Photobooth"
```

Opsional untuk fallback Google Drive:

```bash
export GOOGLE_CLIENT_ID="..."
export GOOGLE_CLIENT_SECRET="..."
```

### Cloudflare Worker

Worker sudah dikonfigurasi untuk:

- Route: `photobooth.collaborationday2026.web.id/*`
- R2 bucket: `photobooth-collaborationday2026`
- D1 database: `photobooth-cloud`

## Install Dependency

```bash
npm install
```

## Development

Jalankan desktop app:

```bash
npm run dev
```

Jalankan build semua workspace:

```bash
npm run build
```

Typecheck semua workspace:

```bash
npm run typecheck
```

## Script Penting

```bash
npm run dev                 # jalankan desktop app mode development
npm run build               # build semua workspace
npm run typecheck           # typecheck semua workspace
npm run package:linux       # buat AppImage dan DEB Linux
npm run install:linux-deb   # install paket DEB ke laptop ini
npm run release:status      # lihat isi folder release desktop
```

## Packaging

Artefak desktop lokal akan muncul di:

```text
apps/desktop/release/
```

Saat ini yang dihasilkan:

- `Collaboration Day Photobooth-0.1.0.AppImage`
- `collaboration-day-photobooth_0.1.0_amd64.deb`

## Install di Linux

Paket `.deb` bisa dipasang dengan:

```bash
sudo apt install ./apps/desktop/release/collaboration-day-photobooth_0.1.0_amd64.deb
```

Atau gunakan script helper:

```bash
npm run install:linux-deb
```

Kalau mau langsung jalankan AppImage:

```bash
./apps/desktop/release/Collaboration\ Day\ Photobooth-0.1.0.AppImage
```

## Menjalankan Flow Booth

1. Jalankan app.
2. Pilih template.
3. Cek kamera.
4. Ambil 3 atau 4 foto.
5. Review dan retake per foto jika perlu.
6. Isi email pengunjung.
7. Publish hasil.
8. App akan:
   - simpan lokal
   - upload ke Cloudflare
   - kirim email hasil lewat Brevo
   - tampilkan QR code

## Canon EOS di Linux

Kamera Canon EOS tidak muncul sebagai webcam browser biasa. App memakai `gphoto2` untuk capture still photo.

Cek deteksi manual:

```bash
gphoto2 --auto-detect
```

Jika ada proses desktop yang mengunci kamera, lepas monitor `gvfs-gphoto2` lalu coba lagi.

## Operator Console

Buka operator panel:

```text
Ctrl/Cmd + Shift + O
```

Fungsi operator saat ini:

- pilih source kamera
- lihat queue dan riwayat sesi
- lihat status Cloudflare
- lihat status Google Drive fallback
- toggle kiosk mode
- reset demo data

## Public Result URL

Contoh URL hasil:

```text
https://photobooth.collaborationday2026.web.id/s/<session-id>
```

## GitHub Release

Release package ada di:

`https://github.com/arifianilhamnrr/photobooth/releases/tag/v0.1.0`

## Catatan

- Folder `apps/desktop/release/` sengaja di-ignore dari git karena ukuran file besar.
- GitHub Release dipakai untuk distribusi package, bukan commit artefak ke repo.
- Windows target sudah dikonfigurasi di `electron-builder`, tapi build Windows idealnya dijalankan di runner Windows.
