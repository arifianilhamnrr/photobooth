# Photobooth Architecture

## 1. Tujuan

Dokumen ini menjadi sumber kebenaran teknis untuk aplikasi photobooth desktop yang:

- Dapat dipasang di Windows dan Linux.
- Tetap dapat mengambil, mengolah, dan menyimpan foto tanpa internet.
- Mendukung kamera internal laptop dan USB webcam.
- Menyediakan jalur integrasi Canon EOS dan Sony Alpha melalui adapter native.
- Menggabungkan 3, 4, atau lebih foto ke template PNG transparan.
- Mendukung retake per foto.
- Membuat satu folder Google Drive publik untuk setiap sesi pengunjung.
- Menampilkan QR folder setelah sinkronisasi berhasil.

Printing, pembayaran, akun pengunjung, dan aplikasi mobile bukan bagian MVP.

## 2. Prinsip Arsitektur

1. **Local-first**: file lokal dan SQLite adalah sumber kebenaran selama sesi berjalan.
2. **Offline-safe**: gangguan internet tidak boleh menggagalkan pengambilan foto.
3. **No data loss**: foto ditulis ke disk secara atomik sebelum dianggap berhasil.
4. **Adapter-based devices**: UI tidak berkomunikasi langsung dengan SDK kamera.
5. **Deterministic rendering**: input dan konfigurasi yang sama menghasilkan strip yang sama.
6. **Least privilege**: renderer Electron tidak memperoleh akses langsung ke Node.js, filesystem, atau token OAuth.
7. **Recoverable work**: aplikasi dapat melanjutkan upload setelah crash atau restart.

## 3. Stack

| Area | Pilihan | Alasan |
| --- | --- | --- |
| Desktop shell | Electron | Dukungan kamera, IPC, filesystem, dan packaging lintas OS matang |
| UI | React + TypeScript + Vite | Cepat untuk kiosk UI dan mudah diuji |
| Main process | TypeScript | Menangani file, database, kamera native, render, dan sinkronisasi |
| Database | SQLite | Lokal, transaksional, tidak membutuhkan service tambahan |
| Image processing | Sharp | Composite resolusi penuh, crop, rotate, mask, dan encode |
| Webcam preview | Chromium MediaDevices | Mendukung kamera internal dan mayoritas webcam UVC |
| Native camera | Adapter/helper process | Mengisolasi gPhoto2 atau SDK vendor dari UI |
| Cloud target | Google Drive API v3 | Folder sesi, upload file, permission, dan share link |
| Authentication | Google OAuth 2.0 PKCE | Admin login tanpa menyimpan password Google |
| QR | Library QR lokal | QR dapat dirender tanpa layanan pihak ketiga |
| Packaging | electron-builder | Installer NSIS Windows, AppImage dan DEB Linux |
| Testing | Vitest + Playwright | Unit/domain tests dan alur Electron end-to-end |

Versi dependency dikunci ketika bootstrap project dilakukan. Dependency native tidak diasumsikan sebelum `package.json` dibuat.

## 4. Struktur Repository

```text
photobooth/
├── apps/
│   └── desktop/
│       ├── src/
│       │   ├── main/            # Electron main process
│       │   ├── preload/         # Typed, narrow IPC bridge
│       │   └── renderer/        # React kiosk dan operator UI
│       └── resources/           # Icons dan packaging assets
├── packages/
│   ├── domain/                  # Session state, entities, validation
│   ├── camera/                  # Camera contracts dan adapters
│   ├── compositor/              # Template validation dan image rendering
│   ├── storage/                 # SQLite repositories dan filesystem
│   └── drive/                   # OAuth dan Google Drive sync
├── fixtures/
│   ├── photos/
│   └── templates/
├── docs/
├── ARCHITECTURE.md
└── DESIGN.md
```

MVP boleh dimulai sebagai satu workspace desktop. Package baru hanya dipisahkan ketika boundary tersebut benar-benar digunakan ulang atau membutuhkan pengujian terisolasi.

## 5. Runtime Boundaries

### Renderer

Renderer bertanggung jawab untuk:

- Navigasi flow pengunjung.
- Live preview.
- Countdown dan feedback capture.
- Pemilihan template dan filter.
- Preview hasil dan retake per foto.
- Status penyimpanan, upload, dan QR.
- Operator console.

Renderer tidak boleh membaca file, membuka SQLite, menjalankan binary, atau menerima refresh token Google.

### Preload

Preload mengekspos API sempit melalui `contextBridge`:

```ts
interface PhotoboothApi {
  camera: {
    list(): Promise<CameraSource[]>;
    connect(sourceId: string): Promise<CameraConnection>;
    capture(sessionId: string, shotIndex: number): Promise<CaptureRecord>;
    disconnect(): Promise<void>;
  };
  templates: {
    list(): Promise<TemplateSummary[]>;
    importPng(path: string): Promise<TemplateDraft>;
    save(input: TemplateInput): Promise<Template>;
  };
  sessions: {
    create(templateId: string): Promise<Session>;
    replaceShot(sessionId: string, shotIndex: number): Promise<CaptureRecord>;
    render(sessionId: string): Promise<CompositeRecord>;
    approve(sessionId: string): Promise<void>;
    getStatus(sessionId: string): Promise<SessionStatus>;
  };
  drive: {
    signIn(): Promise<DriveAccount>;
    signOut(): Promise<void>;
    retry(sessionId: string): Promise<void>;
  };
  system: {
    health(): Promise<SystemHealth>;
    chooseFile(filter: "png"): Promise<string | null>;
  };
}
```

Semua input IPC divalidasi di main process. `nodeIntegration` dimatikan, `contextIsolation` diaktifkan, dan navigasi eksternal diblokir kecuali URL OAuth yang diizinkan.

### Main Process

Main process memiliki service berikut:

- `SessionService`
- `CameraService`
- `TemplateService`
- `CompositeService`
- `LocalMediaService`
- `DriveAuthService`
- `DriveSyncWorker`
- `RecoveryService`
- `HealthService`

Operasi berat seperti composite dan helper kamera native tidak boleh memblokir event loop. Gunakan worker thread atau child process bila profiling menunjukkan kebutuhan.

## 6. Domain Model

### Event

Menyimpan nama event, root folder Drive, timezone, branding, countdown, batas retake, dan kebijakan retensi lokal.

### Template

Template terdiri dari artwork PNG dan geometri slot yang terpisah. Area transparan PNG tidak otomatis dianggap slot karena satu artwork dapat memiliki transparansi dekoratif.

```ts
interface PhotoTemplate {
  id: string;
  name: string;
  version: number;
  canvas: { width: number; height: number };
  overlayPath: string;
  background: { type: "transparent" | "color"; value?: string };
  captureCount: number;
  slots: PhotoSlot[];
  output: {
    format: "jpeg" | "png";
    quality?: number;
    colorSpace: "srgb";
  };
}

interface PhotoSlot {
  id: string;
  photoIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fit: "cover" | "contain";
  focalPoint: { x: number; y: number };
  cornerRadius?: number;
  maskPath?: string;
}
```

Koordinat menggunakan pixel canvas template, bukan persentase. Editor dapat memakai koordinat ter-normalisasi selama interaksi, lalu menyimpan pixel final.

Aturan validasi:

- PNG harus memiliki alpha channel.
- Ukuran PNG harus sama dengan ukuran canvas.
- `captureCount` minimal 1 dan sama dengan indeks foto tertinggi yang dibutuhkan.
- Setiap slot harus berada dalam canvas.
- Beberapa slot boleh menggunakan `photoIndex` yang sama.
- Slot tidak boleh memiliki ukuran nol atau nilai non-finite.
- MVP mendukung slot persegi, rounded, dan rotasi; freeform mask dapat ditambahkan kemudian.

### Session

Satu sesi mewakili satu pengunjung atau grup dan satu folder Google Drive.

```text
draft
  -> capturing
  -> reviewing
  -> rendering
  -> saved_local
  -> sync_pending
  -> syncing
  -> published

Any active state -> failed_recoverable
draft/capturing/reviewing -> cancelled
```

QR hanya tersedia pada status `published`.

### Capture

Satu `shotIndex` memiliki tepat satu capture aktif. Retake membuat revision baru, bukan menimpa file lama saat sesi belum disetujui.

```ts
interface CaptureRecord {
  id: string;
  sessionId: string;
  shotIndex: number;
  revision: number;
  isSelected: boolean;
  filePath: string;
  width: number;
  height: number;
  sha256: string;
  capturedAt: string;
}
```

## 7. Alur Sesi

1. Pengunjung memilih template.
2. Aplikasi membuat session ID lokal dan direktori sesi.
3. Kamera mengambil foto sesuai `captureCount`.
4. Setiap foto disimpan atomik, di-hash, lalu dicatat ke SQLite.
5. Setelah semua slot terisi, compositor membuat preview.
6. Pengunjung dapat memilih retake pada satu foto.
7. Retake membuat revision baru untuk indeks tersebut dan merender preview ulang.
8. Pengunjung menyetujui hasil.
9. Compositor membuat output final resolusi penuh.
10. Session berubah menjadi `saved_local` dan pekerjaan sync dibuat.
11. Worker membuat folder Drive, mengatur permission publik, dan mengunggah file.
12. Worker memverifikasi metadata file, menyimpan URL folder, lalu mengubah status menjadi `published`.
13. Renderer membuat QR lokal dari URL folder dan menampilkannya.

Internet tidak diperlukan pada langkah 1 sampai 10. Jika offline, layar hasil menampilkan bahwa foto aman tersimpan dan menunggu koneksi, bukan QR palsu.

## 8. Kamera

Semua kamera mengimplementasikan kontrak berikut:

```ts
interface CameraAdapter {
  readonly kind: "webcam" | "gphoto" | "canon" | "sony" | "simulated";
  listSources(): Promise<CameraSource[]>;
  connect(sourceId: string): Promise<void>;
  startPreview(target: PreviewTarget): Promise<void>;
  capture(options: CaptureOptions): Promise<NativeCapture>;
  getCapabilities(): Promise<CameraCapabilities>;
  disconnect(): Promise<void>;
}
```

### Internal Camera dan USB Webcam

- Discovery melalui `navigator.mediaDevices.enumerateDevices()`.
- Preview melalui `getUserMedia()`.
- Capture awal melalui frame video resolusi tertinggi yang dinegosiasikan.
- Capability nyata ditampilkan, bukan resolusi yang hanya diminta.
- Mirror hanya diterapkan pada preview jika diperlukan; file final mengikuti setting event.
- Aplikasi menangani permission denied, device busy, unplugged, dan reconnect.

### Canon EOS dan Sony Alpha

Model kamera belum ditentukan, sehingga MVP hanya menetapkan boundary adapter.

- Linux: evaluasi `libgphoto2` per model.
- Windows: evaluasi Canon EDSDK dan Sony Camera Remote SDK per model dan lisensi.
- SDK native berjalan di helper process, bukan renderer.
- File hasil capture dipindahkan ke penyimpanan sesi sebelum adapter melaporkan sukses.
- Daftar kamera yang didukung harus berbasis hasil uji model, OS, firmware, dan mode USB.
- Capture card tetap bisa digunakan sebagai webcam UVC, tetapi kualitas still bergantung output card.

`SimulatedCameraAdapter` wajib tersedia untuk pengembangan dan automated test.

## 9. Image Pipeline

Pipeline output final:

1. Decode foto terpilih dan baca orientasi EXIF.
2. Normalisasi orientasi dan color space ke sRGB.
3. Terapkan filter non-destruktif.
4. Resize dan crop berdasarkan slot dan focal point.
5. Terapkan corner radius atau mask.
6. Rotasi terhadap pusat slot.
7. Composite semua slot sesuai urutan layer.
8. Composite PNG overlay sebagai layer paling atas.
9. Encode output final.
10. Tulis ke file temporary, `fsync`, lalu rename atomik.
11. Hitung SHA-256 dan simpan metadata.

Preview renderer boleh beresolusi rendah, tetapi output final selalu dibuat oleh pipeline main process dari file original. Canvas browser bukan sumber file final.

Struktur file:

```text
PhotoboothData/
├── database/photobooth.sqlite
├── templates/<template-id>/<version>/
│   ├── overlay.png
│   └── template.json
└── events/<event-id>/sessions/<session-id>/
    ├── originals/
    │   ├── shot-01-r01.jpg
    │   ├── shot-02-r01.jpg
    │   └── shot-02-r02.jpg
    ├── output/
    │   ├── strip.jpg
    │   └── strip-thumb.jpg
    └── manifest.json
```

## 10. Retake Per Foto

- Retake hanya tersedia pada layar review.
- Pengunjung memilih satu thumbnail/slot.
- Aplikasi kembali ke live preview dengan label foto yang akan diganti.
- Countdown hanya menghasilkan revision untuk `shotIndex` tersebut.
- Revision lama dipertahankan sampai sesi disetujui.
- Tombol batal mengembalikan pilihan lama tanpa render final baru.
- Batas default: satu retake per foto, dapat diubah admin.
- Setelah approval, pengunjung tidak dapat retake.

Apabila satu foto digunakan oleh beberapa slot, semua slot dengan `photoIndex` tersebut ikut diperbarui.

## 11. SQLite

Tabel minimum:

```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  drive_root_folder_id TEXT,
  settings_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE templates (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  overlay_path TEXT NOT NULL,
  config_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id, version)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  drive_folder_id TEXT,
  drive_folder_url TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  published_at TEXT
);

CREATE TABLE captures (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  shot_index INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  selected INTEGER NOT NULL DEFAULT 0,
  file_path TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  UNIQUE (session_id, shot_index, revision)
);

CREATE TABLE media (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  drive_file_id TEXT,
  uploaded_at TEXT
);

CREATE TABLE sync_jobs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (session_id, kind)
);
```

Schema final dibuat melalui versioned migrations. Foreign keys, WAL mode, dan busy timeout diaktifkan.

## 12. Google Drive dan QR

### Authentication

- Admin login dari operator console menggunakan OAuth 2.0 PKCE.
- Browser sistem digunakan untuk consent.
- Redirect kembali ke loopback listener lokal dengan state acak.
- Refresh token disimpan di OS credential store.
- Token tidak pernah dikirim ke renderer atau ditulis ke log.
- Scope dibatasi pada kebutuhan file yang dibuat aplikasi bila memungkinkan.

### Folder Strategy

```text
<Folder event yang dipilih admin>/
└── YYYY-MM-DD_HH-mm-ss_<short-session-id>/
    ├── strip.jpg
    ├── photo-01.jpg
    ├── photo-02.jpg
    ├── photo-03.jpg
    └── photo-04.jpg
```

Satu folder dibuat untuk satu sesi. Setelah folder dibuat, permission menjadi `anyone / reader`, kemudian URL `https://drive.google.com/drive/folders/<id>` disimpan. QR menunjuk ke URL folder, bukan URL file sementara.

Default MVP mengunggah strip final dan original terpilih. Revision retake yang tidak dipilih tidak diunggah.

### Sync Semantics

- Job bersifat idempotent berdasarkan session dan jenis operasi.
- Jika `drive_folder_id` sudah ada, worker menggunakannya kembali.
- File dianggap selesai hanya setelah Drive mengembalikan ID dan checksum/size dapat diverifikasi.
- Backoff: 5 detik, 15 detik, 1 menit, 5 menit, lalu maksimal 15 menit dengan jitter.
- Error auth menghentikan antrean dan meminta admin login ulang.
- Error jaringan tetap retry otomatis.
- Session lama diproses lebih dahulu, satu sesi sampai selesai agar QR cepat tersedia.

## 13. Recovery dan Retensi

Saat aplikasi dimulai:

1. Jalankan migration dan integrity check ringan.
2. Tandai job `running` lama kembali menjadi `pending`.
3. Validasi media untuk session yang belum published.
4. Render ulang output jika manifest lengkap tetapi output hilang.
5. Lanjutkan antrean ketika jaringan dan OAuth tersedia.

File lokal tidak dihapus segera setelah upload. Default retensi 30 hari dan dapat diubah admin. Cleanup hanya menghapus session `published`, melewati file yang sedang digunakan, dan mencatat audit lokal.

## 14. Security dan Privacy

- Permission Drive `anyone with link` berarti link dapat diteruskan; UI admin harus menjelaskan konsekuensinya.
- Jangan menaruh nama atau data pribadi pada nama folder secara default.
- Gunakan ID acak yang tidak mudah ditebak.
- Redact token, path sensitif, dan payload OAuth dari log.
- Validasi MIME, signature PNG/JPEG, dimensi, dan batas ukuran file template.
- Batasi file picker ke PNG untuk overlay.
- Terapkan Content Security Policy pada renderer.
- Update otomatis tidak masuk MVP; installer baru harus diverifikasi sebelum mengganti aplikasi produksi.

## 15. Observability

Log terstruktur lokal mencakup:

- Timestamp, severity, component, event code, session ID tersamarkan.
- Perubahan state sesi.
- Connect/disconnect kamera.
- Durasi capture dan render.
- Percobaan sync serta kategori error.

Operator console menampilkan status ringkas: kamera, disk, database, internet, akun Drive, jumlah antrean, dan session gagal. Log dapat diekspor admin sebagai file tanpa media dan tanpa token.

## 16. Packaging

Target awal:

- Windows 10/11 x64: installer NSIS.
- Ubuntu 22.04/24.04 x64: AppImage dan DEB.

Build native `sharp`, SQLite, dan helper camera harus dilakukan per target OS. Build Windows tidak dianggap valid hanya karena berhasil dari Linux; jalankan CI matrix atau runner Windows. Code signing Windows direkomendasikan sebelum distribusi publik.

## 17. Testing Strategy

### Unit

- Validasi template dan slot.
- Perhitungan crop/focal point/rotation.
- Session state machine.
- Pemilihan revision retake.
- Retry/backoff dan idempotency.

### Golden Image

- Render fixture yang sama dan bandingkan output dengan toleransi pixel.
- Uji overlay alpha, 3 slot, 4 slot, rounded slot, rotation, dan satu foto pada beberapa slot.

### Integration

- SQLite migration dan crash recovery.
- Filesystem atomic write.
- Mock Google Drive untuk create folder, permission, upload, retry, dan expired token.
- Simulated camera untuk capture dan retake.

### Manual Hardware Matrix

- Internal webcam Windows dan Linux.
- Minimal dua webcam UVC.
- Unplug/reconnect saat idle dan saat capture.
- Canon/Sony per model setelah model ditentukan.
- Internet putus sebelum approval, saat folder dibuat, dan saat upload berlangsung.
- Disk hampir penuh, permission kamera ditolak, akun Drive dicabut.

## 18. Delivery Phases

### Phase 1: Offline Booth Core

- Electron shell dan secure IPC.
- Webcam internal/USB.
- Template JSON + PNG.
- Capture 3/4 foto, review, retake per foto.
- Composite final dan penyimpanan lokal.

### Phase 2: Drive Delivery

- Google OAuth admin.
- Folder per sesi, upload, permission, QR.
- Persistent sync queue dan recovery.

### Phase 3: Operations

- Template editor.
- Operator diagnostics.
- Retention settings.
- Signed Windows/Linux installers.

### Phase 4: Tethered Cameras

- Pilih model Canon/Sony target.
- Implementasi adapter per OS.
- Hardware certification matrix.

## 19. Keputusan yang Ditunda

- Model Canon EOS dan Sony Alpha yang didukung.
- Dukungan RAW/HEIF dan flash control.
- Printing.
- Backend sendiri untuk URL yang tersedia ketika offline.
- Multi-booth cloud administration.
- Auto-update.

Keputusan tertunda tidak boleh menghambat MVP webcam dan Google Drive.
