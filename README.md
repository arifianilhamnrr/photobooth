# Collaboration Day Photobooth

Desktop photobooth offline-first untuk event `Collaboration Day 2026`.

Fitur utama:

- Berjalan di Windows dan Linux.
- Mendukung webcam browser dan Canon EOS tethered via `gphoto2`.
- Template strip berbasis PNG transparan.
- Retake per foto.
- Simpan file lokal per sesi.
- Upload hasil ke Cloudflare Worker + R2 + D1.
- QR code ke link hasil publik.
- Upload dan QR sebelum email opsional.
- GIF animasi dari enam foto.
- Prompt donasi QRIS opsional sebelum download.
- Remote control lewat browser HP dengan pairing QR dan preview ringan.
- Kirim link hasil via Brevo SMTP.

## Status Saat Ini

Yang sudah berjalan end-to-end:

- Capture webcam.
- Capture Canon EOS still photo di Linux.
- Render strip final ke file lokal.
- Upload ke `photobooth.collaborationday2026.web.id`.
- Link publik hasil di Cloudflare.
- Kirim email hasil lewat Brevo SMTP.
- Package Windows `.exe` (NSIS).
- Package Linux `.AppImage`, `.deb`, dan `.pkg.tar.zst` untuk Arch/CachyOS.

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

App membaca konfigurasi dari environment process atau file `env` pada direktori data pengguna.

Linux:

```text
~/.config/@photobooth/desktop/env
```

Windows:

```text
%APPDATA%\@photobooth\desktop\env
```

Isi file:

```bash
export PHOTOBOOTH_CLOUD_URL="https://photobooth.collaborationday2026.web.id"
export BREVO_API_KEY="<smtp-password-brevo>"
export BREVO_SMTP_LOGIN="<smtp-login-brevo>"
export BREVO_SENDER_EMAIL="noreply@collaborationday2026.web.id"
export BREVO_SENDER_NAME="Collaboration Day 2026 Photobooth"
```

Jangan commit file ini. Gunakan `.env.example` sebagai contoh tanpa credential.

Pada Linux dari source checkout, buat template config dengan:

```bash
npm run config:install
```

Setelah instalasi package, file config dapat dibuat manual pada lokasi di atas. Restart app setelah mengubah config.

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
npm run package:arch        # buat paket Arch/CachyOS
npm run package:windows     # buat installer NSIS (jalankan di Windows)
npm run install:linux-deb   # install paket DEB ke laptop ini
npm run install:arch        # install paket Arch/CachyOS
npm run config:install      # buat template config user Linux
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
- `collaboration-day-photobooth-0.1.0-x64.pkg.tar.zst`
- `Collaboration-Day-Photobooth-Setup-0.1.0-x64.exe`

## Install di Linux

### Arch Linux, CachyOS, EndeavourOS, Manjaro

```bash
sudo pacman -U ./apps/desktop/release/collaboration-day-photobooth-0.1.0-x64.pkg.tar.zst
```

Atau:

```bash
npm run install:arch
```

Package Arch mencantumkan `gphoto2` sebagai dependency agar Canon dapat digunakan.

### Ubuntu dan Debian

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

### Windows 10/11 x64

Download dan jalankan:

```text
Collaboration-Day-Photobooth-Setup-0.1.0-x64.exe
```

Installer menggunakan NSIS dan memberi pilihan direktori instalasi. Karena build belum ditandatangani dengan code-signing certificate, Windows SmartScreen mungkin menampilkan peringatan publisher tidak dikenal.

Untuk mengaktifkan email Brevo pada Windows, buat file:

```text
%APPDATA%\@photobooth\desktop\env
```

Gunakan isi dari `.env.example`, lalu restart aplikasi.

Webcam internal, USB webcam, capture card, dan kamera UVC seperti Insta360 Webcam Mode dapat digunakan lewat MediaDevices. Integrasi Canon tethered berbasis `gphoto2` saat ini hanya disertifikasi di Linux; Canon pada Windows belum dinyatakan didukung.

## Menjalankan Flow Booth

1. Jalankan app.
2. Pilih template.
3. Cek kamera.
4. Ambil 6 foto dengan konfirmasi per foto.
5. Review, retake, dan pilih filter.
6. Upload hasil.
7. Scan QR atau kirim link ke email secara opsional.
8. App akan:
   - simpan lokal
   - upload ke Cloudflare
   - membuat strip HD dan GIF
   - mengirim email hasil lewat Brevo jika diminta
   - tampilkan QR code

## Remote HP

Remote tidak membutuhkan aplikasi mobile. Buka panel Operator, aktifkan `Remote HP`, lalu scan QR pairing dari browser HP.

Remote dapat:

- melihat preview kamera ringan
- memulai countdown
- memilih `Ulang` atau `Next`
- download strip dan GIF langsung dari laptop

Jika laptop dan HP berada pada Wi-Fi yang sama, remote memakai alamat LAN laptop. Jika jaringan memblokir komunikasi antarperangkat atau laptop tidak terhubung Wi-Fi, operator dapat memilih `Gunakan hotspot`.

Pada hotspot Linux:

- SSID dan password tampil di panel operator
- remote tetap bekerja tanpa internet
- upload Cloudflare menunggu sampai internet tersedia kembali

Original enam foto tetap lokal. Cloudflare hanya menerima `strip.jpg` dan `slideshow.gif`.

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

## Autostart di Linux

Untuk laptop booth yang harus langsung membuka app saat login desktop:

```bash
npm run autostart:install
```

Untuk mematikan autostart:

```bash
npm run autostart:remove
```

File autostart akan dibuat di:

```text
/home/ar/.config/autostart/collaboration-day-photobooth.desktop
```

## Catatan

- Folder `apps/desktop/release/` sengaja di-ignore dari git karena ukuran file besar.
- GitHub Release dipakai untuk distribusi package, bukan commit artefak ke repo.
- Windows installer dibangun pada runner Windows melalui `.github/workflows/release-desktop.yml`.
- Release workflow juga membangun AppImage, DEB, dan paket Arch.
