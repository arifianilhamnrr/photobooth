# Photobooth Product and Interface Design

## 1. Design Read

Aplikasi kiosk photobooth untuk pengunjung event dan operator, dengan bahasa visual editorial-studio yang ramah, cepat dibaca dari jarak jauh, dan tidak terasa seperti dashboard SaaS.

- `DESIGN_VARIANCE: 6`
- `MOTION_INTENSITY: 4`
- `VISUAL_DENSITY: 3`

Dokumen ini mendefinisikan pengalaman dan sistem visual. Branding event dapat mengganti logo, warna aksen, copy, dan artwork template tanpa mengubah struktur interaksi.

## 2. Experience Goals

Pengunjung harus bisa menyelesaikan sesi tanpa instruksi operator.

1. **Jelas dari jarak jauh**: satu keputusan utama per layar.
2. **Cepat**: alur normal 3 atau 4 foto tidak memiliki form atau menu teknis.
3. **Menenangkan**: kegagalan internet tidak membuat pengunjung mengira fotonya hilang.
4. **Tactile**: countdown, shutter, pilihan foto, dan status simpan memberi feedback tegas.
5. **Event-ready**: kontrol teknis tersembunyi di operator console.
6. **Brandable**: template foto dan visual aplikasi dapat mengikuti identitas event.

## 3. Modes

### Guest Kiosk

- Fullscreen.
- Pointer/touch-first.
- Tidak menampilkan path file, token, stack trace, atau istilah API.
- Tidak dapat keluar aplikasi melalui kontrol biasa.
- Session otomatis kembali ke welcome setelah selesai atau timeout.

### Operator Console

- Dibuka dengan shortcut dan PIN.
- Mengelola kamera, template, event, Google Drive, antrean, retensi, dan diagnostics.
- Dapat keluar fullscreen atau menutup aplikasi setelah konfirmasi.
- Menggunakan komponen lebih padat tetapi tetap konsisten dengan visual kiosk.

## 4. Information Architecture

### Guest Flow

```text
Welcome
  -> Choose Template
  -> Camera Ready
  -> Capture 1..N
  -> Review
      -> Retake One Photo -> Capture Replacement -> Review
      -> Approve
  -> Saving Locally
  -> Uploading
  -> QR Ready
  -> End / Auto Reset
```

### Operator Flow

```text
PIN
  -> Overview
  -> Event Setup
  -> Camera
  -> Templates
  -> Google Drive
  -> Sync Queue
  -> Storage and Retention
  -> Diagnostics
```

## 5. Visual Direction

### Character

Gunakan suasana studio foto modern: bidang gelap netral, tipografi sans yang kuat, garis framing tipis, preview foto besar, dan satu warna aksen event. Hindari tampilan neon, glow, glassmorphism berlebihan, gradient ungu-biru, serta kumpulan card generik.

UI adalah panggung untuk wajah dan template, bukan elemen paling ramai. Artwork PNG milik event harus tetap menjadi visual utama.

### Theme

Guest kiosk memakai dark theme terkunci agar preview kamera dominan dan pencahayaan layar lebih terkendali. Operator console menggunakan family warna gelap yang sama. Light mode tidak menjadi target MVP karena perangkat adalah kiosk terkontrol, bukan web consumer umum.

### Color Tokens

Nilai default dapat diganti per event, tetapi semantic role tidak berubah.

```css
:root {
  --surface-canvas: #101112;
  --surface-panel: #181a1c;
  --surface-raised: #222528;
  --border-subtle: #34383c;
  --text-primary: #f2f1ed;
  --text-secondary: #b2b4b3;
  --text-muted: #7f8384;
  --accent: #ff7048;
  --accent-contrast: #15110f;
  --success: #79a86b;
  --warning: #d6a653;
  --danger: #d96b62;
}
```

Aturan:

- Hanya satu accent event aktif.
- Accent harus memiliki pasangan teks yang lulus WCAG AA.
- Hijau, kuning, dan merah hanya untuk status, bukan dekorasi.
- Hindari pure black dan pure white.
- Preview foto tidak diberi color overlay UI.

### Typography

- Display/UI: `Manrope` atau sans geometrik setara yang disimpan lokal.
- Technical labels/numbers: `IBM Plex Mono` atau mono setara yang disimpan lokal.
- Jangan memuat font dari Google Fonts karena aplikasi harus offline.
- Heading memakai tracking rapat dan weight 700/800.
- Body minimum 18 px pada layar kiosk.
- Tombol utama minimum 18 px dengan label singkat.
- Mono label digunakan secukupnya untuk countdown, nomor foto, dan status perangkat.

### Shape

- Panels dan preview: radius 12 px.
- Inputs dan tombol persegi: radius 10 px.
- Status chip: pill.
- Photo slot mengikuti template dan tidak dipaksa menggunakan radius UI.
- Shadow hanya untuk modal/sheet; hierarchy utama memakai bidang dan border.

## 6. Layout System

Target utama adalah layar landscape 16:9 pada 1366x768 sampai 1920x1080. UI harus tetap berfungsi pada 1280x720.

- Safe edge desktop: 32-56 px.
- Maksimum tinggi top bar: 72 px.
- Minimum touch target: 48x48 px; target utama 56 px.
- Jarak antar tombol yang berdekatan minimum 12 px.
- Satu CTA primer per layar.
- CTA primer selalu terlihat tanpa scroll pada resolusi target.
- Gunakan CSS Grid untuk layout studio dan review.
- Tidak ada konten guest yang membutuhkan vertical scroll.

Pada viewport portrait atau sempit, tampilkan layar operator-friendly yang meminta perangkat diputar. Responsive mobile penuh bukan kebutuhan kiosk desktop.

## 7. Persistent Chrome

Top bar guest berisi:

- Logo/nama event di kiri.
- Progress sesi di tengah atau kanan: `FOTO 2 DARI 4`.
- Status minimal di kanan: kamera siap atau tersimpan.

Jangan tampilkan jam, dashboard metrics, upload queue, atau shortcut operator secara menonjol kepada pengunjung.

Operator console dapat dibuka melalui `Ctrl/Cmd + Shift + O`, lalu PIN. Hot corner tersembunyi dapat disediakan untuk perangkat touch-only.

## 8. Guest Screens

### 8.1 Welcome

Tujuan: membuat tindakan pertama sangat jelas.

Konten:

- Logo atau nama event.
- Headline maksimal dua baris, misalnya `Siap bikin kenangan?`
- Satu kalimat maksimal 16 kata.
- Tombol primer `Mulai`.
- Preview dekoratif dari satu template aktif, bukan kumpulan card fitur.

Interaksi apa pun pada area utama dapat mengaktifkan tombol mulai, tetapi jangan memulai kamera tanpa tindakan eksplisit bila permission belum diberikan.

### 8.2 Choose Template

Tujuan: memilih desain strip sebelum foto diambil.

- Tampilkan thumbnail hasil komposit dengan sample portrait, bukan PNG transparan kosong.
- Setiap item menunjukkan nama dan jumlah foto, misalnya `Classic Strip · 4 foto`.
- Gunakan horizontal carousel/scroll-snap bila template lebih dari empat.
- Template terpilih memiliki border accent dan check mark dari satu icon family.
- CTA `Pakai template ini`.
- Jika hanya ada satu template aktif, layar ini dapat dilewati.

### 8.3 Camera Ready

Tujuan: memastikan pengunjung melihat framing sebelum rangkaian dimulai.

- Live preview mengambil sebagian besar layar.
- Garis safe framing opsional dan tidak masuk file.
- Copy pendek: `Semua sudah masuk frame?`
- Tampilkan jumlah foto dan ritme countdown.
- CTA `Mulai foto`.
- Tombol kembali kecil, tidak berkompetisi dengan CTA primer.

### 8.4 Capture

Tujuan: memberi ritme yang dapat diprediksi.

State per foto:

```text
Get ready -> 3 -> 2 -> 1 -> shutter -> saved -> pose break -> next
```

- Preview tetap memenuhi area utama.
- Countdown sangat besar dan berada di tengah.
- Header menunjukkan `Foto 2 dari 4`.
- Pada shutter, gunakan flash overlay singkat dan feedback suara opsional.
- Setelah capture, tampilkan thumbnail freeze maksimal 800 ms sebelum pose berikutnya.
- Pose break 1.5-2 detik dengan copy seperti `Ganti gaya`.
- Jangan sediakan retake selama sequence agar flow tidak pecah.
- Escape operator tetap bekerja meskipun countdown aktif.

Apabila kamera gagal, countdown berhenti dan tampilkan pesan operasional yang sederhana: `Kamera terputus. Tunggu operator sebentar.` Foto yang telah tersimpan tidak hilang.

### 8.5 Review

Tujuan: memeriksa semua foto dan memilih satu foto untuk retake jika perlu.

Layout desktop:

- Preview strip besar di kiri, sekitar 55-65% area.
- Daftar thumbnail foto asli di kanan atau bawah.
- Setiap thumbnail memiliki nomor dan tombol `Ulangi`.
- CTA primer `Gunakan hasil ini`.
- Status retake tersisa ditulis jelas, misalnya `1 kali ulangi untuk tiap foto`.

Retake berlaku berdasarkan `photoIndex`, bukan kotak visual. Jika foto pertama muncul dua kali pada template, memilih salah satunya menandai keduanya dan copy menjelaskan bahwa keduanya menggunakan foto yang sama.

Tidak ada tombol `Ulangi semua` pada MVP.

### 8.6 Retake Confirmation

Setelah tombol `Ulangi` ditekan:

- Tampilkan dialog: `Ulangi foto 2?`
- Preview thumbnail lama.
- CTA primer `Ya, ambil ulang`.
- CTA sekunder `Batal`.

Setelah capture pengganti, layar review kembali dengan hasil baru. Sediakan aksi `Kembalikan foto lama` sampai sesi disetujui jika batas waktu memungkinkan.

### 8.7 Saving and Uploading

Saving lokal dan upload adalah dua status berbeda.

State copy:

| State | Headline | Supporting copy |
| --- | --- | --- |
| Rendering | `Lagi merapikan strip kamu` | `Jangan tutup aplikasinya dulu.` |
| Saved local | `Foto kamu sudah aman` | `Kami sedang menyiapkan link unduhan.` |
| Offline | `Foto kamu sudah aman` | `Internet sedang terputus. QR akan muncul setelah tersambung.` |
| Uploading | `Mengunggah hasil` | `Biasanya hanya beberapa detik.` |
| Recoverable error | `Foto tetap tersimpan` | `Operator akan membantu menyiapkan link.` |

Gunakan progress determinate hanya jika byte upload benar-benar diketahui. Jangan membuat progress palsu.

### 8.8 QR Ready

Tujuan: pengunjung memindai dan meninggalkan booth dengan yakin.

- QR minimum 280x280 logical px pada 1080p.
- Quiet zone QR tidak boleh tertutup branding.
- Headline `Scan untuk ambil fotomu`.
- URL pendek visual tidak diperlukan karena URL Drive panjang.
- Tampilkan strip final sebagai pendamping, bukan background di belakang QR.
- Status `Folder Google Drive siap`.
- CTA `Selesai`.
- Auto reset default 60 detik dengan countdown kecil; aktivitas pointer mereset timeout satu kali.

QR menunjuk ke folder sesi yang memiliki permission `anyone with the link`.

## 9. Offline Behavior

Offline bukan error capture.

- Badge kecil `Offline` dapat tampil di top bar tanpa menutupi flow.
- Capture, retake, render, dan save tetap aktif.
- Setelah approval, tampilkan bahwa file aman tersimpan.
- Jangan pernah menampilkan QR sebelum URL Drive benar-benar tersedia.
- Operator dapat mengakhiri layar pengunjung; session tetap berada di antrean.
- Ketika upload selesai kemudian, URL tersedia di riwayat operator.

Apabila kebutuhan bisnis berubah dan QR harus langsung tersedia saat offline, produk membutuhkan backend dengan URL stabil sendiri. Hal tersebut bukan perilaku MVP ini.

## 10. Template System

### Artwork Contract

Designer menyediakan:

- PNG dengan alpha/transparency.
- Ukuran pixel sama dengan canvas output.
- Color profile sRGB.
- Artwork, logo, frame, dan teks berada pada PNG.
- Area calon foto dibiarkan transparan, tetapi slot tetap didefinisikan di editor.

Ukuran yang direkomendasikan:

- Portrait digital/4x6: 1200x1800 px.
- Landscape digital/6x4: 1800x1200 px.
- Strip panjang: sesuai kebutuhan, dengan sisi pendek minimal 1200 px.

### Layer Order

```text
Top       PNG overlay/frame
Middle    Photo slots, ordered by slot list
Bottom    Solid/transparent background
```

### Three and Four Photo Templates

- Template menentukan `captureCount`, bukan aplikasi secara global.
- Template 3 foto menjalankan tiga capture.
- Template 4 foto menjalankan empat capture.
- Jumlah slot dapat lebih besar daripada jumlah capture jika sebuah foto dipakai ulang.
- Filter dapat dipilih sebelum capture atau ditetapkan oleh template/event.
- Crop default adalah `cover` dengan focal point tengah.

## 11. Template Editor

Template editor berada di operator console dan tidak dapat dibuka guest.

Alur:

1. Pilih PNG.
2. Validasi alpha, dimensi, color space, dan ukuran file.
3. Tentukan nama template dan jumlah foto.
4. Tambahkan slot.
5. Drag dan resize slot di atas artwork.
6. Atur `photoIndex`, crop, focal point, rotation, dan corner radius.
7. Preview dengan fixture portrait.
8. Jalankan preflight.
9. Simpan sebagai version baru dan aktifkan.

Editor layout:

- Canvas besar di kiri.
- Inspector slot di kanan.
- Toolbar ringkas untuk add, duplicate, delete, zoom, undo, dan redo.
- Slot diberi warna outline berbeda dari artwork serta label `FOTO 1`, `FOTO 2`.
- Artwork dapat diturunkan opacity sementara agar batas slot terlihat.
- Snap ke edge, center, dan slot lain; tampilkan guide numerik.

Preflight menolak:

- Slot keluar canvas.
- Slot tanpa photo index valid.
- Capture yang tidak digunakan tanpa konfirmasi.
- Overlay tidak sama ukuran dengan canvas.
- PNG tanpa alpha channel.
- Output terlalu kecil.

Editor freeform alpha-mask tidak masuk MVP. Slot rounded dan rotation sudah cukup untuk versi awal.

## 12. Filters

Filter harus ringan dan konsisten antara preview dan output final.

MVP:

- Original.
- Black and white.
- Warm.
- Cool.
- High contrast.

Preview boleh memakai CSS approximation agar real-time, tetapi parameter final harus didefinisikan dalam pipeline Sharp. Perbedaan preview dan output tidak boleh mencolok. Jangan mengubah bentuk wajah atau menggunakan generative filter pada MVP.

## 13. Operator Console

### Overview

Tampilkan status penting tanpa card berlebihan:

- Kamera dan resolusi aktif.
- Internet.
- Akun Google Drive.
- Session menunggu upload.
- Ruang disk tersisa.
- Session gagal yang membutuhkan tindakan.

Gunakan grouped rows dengan divider dan satu status rail, bukan enam card identik.

### Event Setup

- Nama event.
- Logo dan accent color.
- Template aktif.
- Countdown dan pose break.
- Batas retake per foto.
- Auto-reset duration.
- Pilihan simpan originals ke Drive.

### Camera

- Daftar kamera terdeteksi.
- Jenis adapter dan capability aktual.
- Live test preview.
- Capture test yang tidak masuk session.
- Reconnect.
- Indikator permission/device busy.

### Google Drive

- Tombol login/logout admin.
- Identitas akun aktif.
- Pemilih root folder event.
- Tes membuat dan menghapus folder test.
- Penjelasan permission publik.
- Status token tanpa memperlihatkan token.

### Sync Queue

- Session ID pendek, waktu, status, jumlah file, attempt, dan error ringkas.
- Aksi `Coba lagi` per session.
- Aksi retry all hanya untuk item gagal.
- Link buka folder setelah published.
- Jangan izinkan menghapus session pending tanpa konfirmasi berlapis.

### Storage

- Lokasi data lokal.
- Pemakaian disk.
- Retensi default.
- Export log.
- Cleanup manual hanya untuk session published.

## 14. Component Inventory

- `AppShell`
- `GuestTopBar`
- `PrimaryAction`
- `SecondaryAction`
- `CameraPreview`
- `CaptureCountdown`
- `SessionProgress`
- `TemplateCarousel`
- `TemplateThumbnail`
- `PhotoStripPreview`
- `ShotThumbnail`
- `RetakeDialog`
- `SaveStatus`
- `QrDeliveryPanel`
- `ConnectionBadge`
- `OperatorSheet`
- `StatusRow`
- `CameraSelector`
- `TemplateCanvasEditor`
- `SlotInspector`
- `SyncQueueTable`
- `InlineError`

Gunakan satu icon family, direkomendasikan Phosphor, setelah dependency ditambahkan. Jangan menggambar SVG icon manual atau menggunakan emoji sebagai icon UI.

## 15. Interaction and Motion

Motion harus mengomunikasikan state, bukan sekadar dekorasi.

- Screen transition: opacity + translate maksimal 240 ms.
- Button press: scale `0.98` atau translate 1 px.
- Template selection: border/color transition 160 ms.
- Countdown: scale masuk singkat tanpa bounce berlebihan.
- Shutter: white/off-white overlay 80-120 ms.
- Review update: crossfade slot yang diganti.
- QR ready: reveal satu kali setelah status published.

Hanya animasikan transform dan opacity. Semua motion menghormati `prefers-reduced-motion`; countdown angka tetap berubah tanpa scale animation. Tidak ada parallax, marquee, scroll hijack, atau perpetual floating effect.

## 16. Sound

- Countdown beep opsional, default aktif dengan volume moderat.
- Shutter sound aktif kecuali operator mematikan.
- Error memiliki bunyi berbeda tetapi tidak agresif.
- Setting sound tersimpan per booth.
- UI tidak mengandalkan suara sebagai satu-satunya feedback.

## 17. Accessibility

- Semua teks dan kontrol lulus WCAG AA.
- Focus ring selalu terlihat di operator console.
- Guest flow dapat digunakan dengan keyboard dan touch.
- Jangan mengandalkan warna saja untuk status atau selection.
- Tombol memiliki label tindakan, bukan hanya icon.
- Countdown memiliki update visual; live region tidak mengumumkan setiap frame preview.
- QR disertai instruksi teks dan operator dapat membuka link dari console.
- Reduced motion dihormati.
- Copy error tidak menyalahkan pengguna.

## 18. Copy Style

Bahasa utama MVP: Bahasa Indonesia. Copy harus singkat, hangat, dan fungsional.

Gunakan:

- `Mulai`
- `Foto 2 dari 4`
- `Ganti gaya`
- `Ulangi foto ini`
- `Gunakan hasil ini`
- `Foto kamu sudah aman`
- `Scan untuk ambil fotomu`

Hindari:

- Istilah `sync job`, `OAuth`, `API`, atau `revision` pada guest UI.
- Copy puitis yang mengaburkan tindakan.
- Tanda seru pada setiap layar.
- Pesan `Upload failed` tanpa menjelaskan bahwa file lokal aman.

## 19. State Coverage

Setiap fitur harus mendesain state berikut sebelum dianggap selesai:

- Loading.
- Empty.
- Success.
- Recoverable error.
- Fatal error.
- Offline.
- Permission denied.
- Device disconnected.
- Disk low/full.
- OAuth expired/revoked.
- Session timeout.

Contoh camera empty state: `Belum ada kamera yang tersedia. Hubungkan kamera, lalu buka Operator untuk mencoba lagi.`

## 20. Session Timing Defaults

| Tahap | Default |
| --- | --- |
| Ready screen timeout | 60 detik |
| Countdown per foto | 3 detik |
| Pose break | 2 detik |
| Review timeout | 90 detik |
| QR screen timeout | 60 detik |
| Retake limit | 1 per foto |

Operator dapat mengubah nilai tersebut dalam rentang aman. Saat timeout review, jangan otomatis menyetujui hasil tanpa warning countdown. Default setelah warning adalah menyimpan hasil terbaru dan melanjutkan, agar booth tidak terkunci.

## 21. Acceptance Criteria MVP

- Pengunjung dapat mengambil strip 3 dan 4 foto tanpa internet.
- PNG transparan tampil sebagai overlay paling atas pada output final.
- Foto tercrop sesuai slot tanpa distorsi.
- Pengunjung dapat retake satu foto tanpa mengulang foto lain.
- Retake pada photo index yang dipakai ulang memperbarui semua slot terkait.
- Original terpilih dan strip final tersimpan setelah restart/crash.
- Saat online, satu folder Drive publik dibuat per session.
- QR hanya muncul setelah folder dan upload berhasil.
- Saat offline, UI menyatakan file aman dan session masuk antrean.
- Operator dapat mengganti kamera internal/USB dan menguji capture.
- Operator dapat mengimpor PNG dan mengatur slot tanpa menulis JSON manual.
- Semua guest screen muat pada 1280x720 tanpa scroll.
- Build tersedia untuk Windows dan Linux.

## 22. Out of Scope MVP

- Cetak otomatis/manual.
- Pembayaran.
- Gallery publik lintas session.
- Face beautification atau AI filters.
- Video/GIF/boomerang.
- QR yang langsung aktif saat komputer offline.
- Dukungan universal semua Canon dan Sony.
- Mobile companion app.
- Multi-tenant cloud dashboard.

## 23. Design QA Checklist

- CTA primer hanya satu per layar.
- Label tombol tidak membungkus pada resolusi target.
- Guest flow tidak memiliki scroll.
- Preview kamera tidak terdistorsi.
- Crop preview cocok dengan hasil final.
- Frame PNG tidak tertutup foto.
- QR memiliki quiet zone dan dapat dipindai dari beberapa ponsel.
- State offline dan file aman terlihat jelas.
- Retake yang dipilih tidak membingungkan slot versus photo index.
- Focus, touch target, contrast, reduced motion, dan sound-off diuji.
- Copy Bahasa Indonesia dibaca ulang dan tidak mengandung istilah teknis.
- UI diuji pada 1280x720, 1366x768, dan 1920x1080.
