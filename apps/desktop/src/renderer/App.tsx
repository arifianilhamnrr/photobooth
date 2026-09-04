import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import providedFrameUrl from "./assets/photobhoot-transparent.png";
import {
  defaultSettings,
  filters,
  getTemplate,
  templates,
  type BoothSettings,
  type CameraSource,
  type CloudStatus,
  type DriveStatus,
  type FilterId,
  type PhotoTemplate,
  type QueueItem,
  type StoredSession,
  type StoredShot
} from "@photobooth/domain";

type Step = "welcome" | "template" | "ready" | "capture" | "review" | "email" | "saving" | "result";

const CAPTURE_INTERVAL_MS = 900;

export default function App() {
  const [systemStatus, setSystemStatus] = useState("Memeriksa aplikasi");
  const [settings, setSettings] = useState<BoothSettings>(defaultSettings);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [allSessions, setAllSessions] = useState<StoredSession[]>([]);
  const [cameraSources, setCameraSources] = useState<CameraSource[]>([]);
  const [selectedCameraSourceId, setSelectedCameraSourceId] = useState("webcam:default");
  const [driveStatus, setDriveStatus] = useState<DriveStatus>({ mode: "mock" });
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>({ mode: "unconfigured" });
  const [step, setStep] = useState<Step>("welcome");
  const [templateId, setTemplateId] = useState(templates[0].id);
  const [filterId, setFilterId] = useState<FilterId>("original");
  const [session, setSession] = useState<StoredSession | null>(null);
  const [countdown, setCountdown] = useState(3);
  const [captureIndex, setCaptureIndex] = useState(0);
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);
  const [queueStatus, setQueueStatus] = useState("Siap memulai sesi baru");
  const [qrUrl, setQrUrl] = useState("");
  const [operatorOpen, setOperatorOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string>("");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraLabel, setCameraLabel] = useState("Kamera belum dipilih");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const template = useMemo<PhotoTemplate>(() => getTemplate(session?.templateId ?? templateId), [session?.templateId, templateId]);
  const filter = useMemo(() => filters.find((item) => item.id === (session?.filterId ?? filterId)) ?? filters[0], [filterId, session?.filterId]);
  const shots = session?.shots ?? [];

  useEffect(() => {
    window.photobooth.system.ping().then(() => setSystemStatus("Desktop siap dipakai")).catch(() => setSystemStatus("Main process tidak merespons"));
    void refreshSnapshot();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "o") {
        setOperatorOpen((value) => !value);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (step !== "capture" || !session) return;
    if (countdown > 1) {
      const timer = window.setTimeout(() => setCountdown((value) => value - 1), CAPTURE_INTERVAL_MS);
      return () => clearTimeout(timer);
    }

    const timer = window.setTimeout(() => {
      const targetIndex = replaceIndex ?? captureIndex;
      void window.photobooth.sessions.captureShot({ sessionId: session.id, shotIndex: targetIndex, dataUrl: captureFrame() ?? undefined }).then((nextSession) => {
        setSession(nextSession);
        updateSessionCollection(nextSession);
        setCountdown(settings.countdownSeconds);

        if (replaceIndex !== null) {
          setReplaceIndex(null);
          setQueueStatus(`Foto ${targetIndex + 1} berhasil diulang.`);
          setStep("review");
          return;
        }

        if (targetIndex + 1 >= template.captureCount) {
          setQueueStatus("Semua foto sudah diambil. Cek hasil strip kamu.");
          setStep("review");
          return;
        }

        setCaptureIndex(targetIndex + 1);
        setQueueStatus(`Foto ${targetIndex + 1} tersimpan. Ganti gaya untuk foto berikutnya.`);
      });
    }, CAPTURE_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [captureIndex, countdown, replaceIndex, session, settings.countdownSeconds, step, template.captureCount]);

  useEffect(() => {
    if (step !== "ready" && step !== "capture") {
      stopCamera();
      return;
    }

    void startCamera();
    return () => {
      if (step !== "capture") stopCamera();
    };
  }, [step]);

  useEffect(() => {
    if (step !== "result" || !session?.driveUrl) return;
    void QRCode.toDataURL(session.driveUrl, {
      width: 320,
      margin: 1,
      color: { dark: "#f2f1ed", light: "#151617" }
    }).then(setQrUrl);
  }, [session?.driveUrl, step]);

  async function refreshSnapshot() {
    const snapshot = await window.photobooth.app.snapshot();
    setSettings(snapshot.settings);
    setAllSessions(snapshot.sessions);
    setQueue(snapshot.queue);
    setCameraSources(snapshot.cameraSources);
    setSelectedCameraSourceId(snapshot.selectedCameraSourceId);
    setDriveStatus(snapshot.driveStatus);
    setCloudStatus(snapshot.cloudStatus);
  }

  async function startCamera() {
    if (selectedCameraSourceId.startsWith("gphoto:")) {
      stopCamera();
      const source = cameraSources.find((item) => item.id === selectedCameraSourceId);
      setCameraLabel(source?.label ?? "Canon EOS");
      setCameraReady(false);
      setCameraError("Preview live Canon belum aktif. Capture akan diambil langsung dari kamera.");
      return;
    }
    if (streamRef.current || !videoRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: "user"
        },
        audio: false
      });
      streamRef.current = stream;
      const [track] = stream.getVideoTracks();
      setCameraLabel(track?.label || "Kamera aktif");
      setCameraReady(true);
      setCameraError("");
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
    } catch (error) {
      setCameraReady(false);
      setCameraError(error instanceof Error ? error.message : "Kamera tidak tersedia");
      setCameraLabel("Fallback demo");
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }

  function captureFrame(): string | null {
    const video = videoRef.current;
    if (!video || !cameraReady || video.videoWidth === 0 || video.videoHeight === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.92);
  }

  function updateSessionCollection(nextSession: StoredSession) {
    setAllSessions((current) => [nextSession, ...current.filter((item) => item.id !== nextSession.id)]);
  }

  async function startSession() {
    const nextSession = await window.photobooth.sessions.create({ templateId, filterId });
    setSession(nextSession);
    updateSessionCollection(nextSession);
    setCaptureIndex(0);
    setCountdown(settings.countdownSeconds);
    setReplaceIndex(null);
    setQrUrl("");
    setRecipientEmail("");
    setEmailError("");
    setQueueStatus("Pilih template untuk sesi ini.");
    setStep(templates.length > 1 ? "template" : "ready");
  }

  function beginCapture() {
    if (!session) return;
    setCaptureIndex(0);
    setCountdown(settings.countdownSeconds);
    setQueueStatus(`Ambil ${template.captureCount} foto untuk template ${template.name}.`);
    setStep("capture");
  }

  function requestRetake(shotIndex: number) {
    setReplaceIndex(shotIndex);
    setCountdown(settings.countdownSeconds);
    setQueueStatus(`Mengulang foto ${shotIndex + 1}.`);
    setStep("capture");
  }

  function finishReview() {
    if (!session || shots.length !== template.captureCount) return;
    setEmailError("");
    setStep("email");
  }

  async function submitEmailAndPublish() {
    if (!session) return;
    const email = recipientEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError("Masukkan email yang valid dulu.");
      return;
    }
    setStep("saving");
    setQueueStatus("Foto kamu sudah aman. Kami sedang mengirim link ke email kamu.");
    const published = await window.photobooth.sessions.publish({ sessionId: session.id, recipientEmail: email });
    setSession(published);
    updateSessionCollection(published);
    setQueue((current) => {
      const nextItem: QueueItem = {
        sessionId: published.id,
        status: "published",
        createdAt: published.createdAt,
        updatedAt: published.updatedAt,
        driveUrl: published.driveUrl
      };
      return [nextItem, ...current.filter((item) => item.sessionId !== published.id)];
    });
    setStep("result");
    setQueueStatus("Link hasil siap dan email sudah diproses.");
  }

  function resetToWelcome() {
    setSession(null);
    setQrUrl("");
    setReplaceIndex(null);
    setQueueStatus("Siap memulai sesi baru");
    setStep("welcome");
  }

  async function updateAccentColor(event: React.ChangeEvent<HTMLInputElement>) {
    const next = await window.photobooth.settings.update({ accentColor: event.target.value });
    setSettings(next);
  }

  async function changeCameraSource(sourceId: string) {
    await window.photobooth.camera.selectSource(sourceId);
    setSelectedCameraSourceId(sourceId);
    const sources = await window.photobooth.camera.listSources();
    setCameraSources(sources);
    stopCamera();
    if (step === "ready" || step === "capture") void startCamera();
  }

  async function resetStore() {
    await window.photobooth.debug.reset();
    setSession(null);
    setStep("welcome");
    setQrUrl("");
    setQueueStatus("Data lokal direset untuk demo.");
    await refreshSnapshot();
  }

  async function signInDrive() {
    const status = await window.photobooth.drive.signIn();
    setDriveStatus(status);
  }

  async function signOutDrive() {
    const status = await window.photobooth.drive.signOut();
    setDriveStatus(status);
  }

  async function createDriveRootFolder() {
    const status = await window.photobooth.drive.createRootFolder(settings.driveRootFolderName);
    setDriveStatus(status);
  }

  return (
    <main className="app-shell" style={{ ["--accent-color" as string]: settings.accentColor }}>
      <header className="topbar">
        <div>
          <p className="topbar-label">PHOT OBOOTH</p>
          <strong className="brand">{settings.eventName}</strong>
        </div>
        <div className="topbar-meta">
          <span className="status-pill"><i /> {systemStatus}</span>
          <span className="status-pill muted">{queueStatus}</span>
          <button className="secondary-button operator-toggle" onClick={() => setOperatorOpen(true)}>Operator</button>
        </div>
      </header>

      {step === "welcome" && (
        <section className="welcome-layout screen-card">
          <div className="copy-column">
            <p className="eyebrow">EVENT KIOSK</p>
            <h1>Siap bikin strip foto yang bisa langsung diambil lewat QR?</h1>
            <p className="body">Offline dulu untuk capture dan render. Begitu koneksi ada, hasilmu otomatis masuk folder Google Drive.</p>
            <button className="primary-button" onClick={() => void startSession()}>Mulai</button>
          </div>
          <StripShowcase template={template} shots={sampleShots(template.captureCount)} filterCss={filter.cssFilter} />
        </section>
      )}

      {step === "template" && session && (
        <section className="screen-card stack-gap">
          <div className="section-head">
            <div>
              <p className="eyebrow">PILIH TEMPLATE</p>
              <h2>Pilih gaya strip dulu.</h2>
            </div>
            <p className="body small">Setiap template menentukan jumlah foto yang harus diambil.</p>
          </div>
          <div className="template-grid">
            {templates.map((item) => {
              const selected = item.id === templateId;
              return (
                <button key={item.id} className={`template-card${selected ? " selected" : ""}`} onClick={() => setTemplateId(item.id)}>
                  <StripShowcase template={item} shots={sampleShots(item.captureCount)} filterCss={filter.cssFilter} compact />
                  <div className="template-meta">
                    <strong>{item.name}</strong>
                    <span>{item.captureCount} foto</span>
                    <p>{item.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="action-row">
            <div className="filter-row">
              {filters.map((item) => (
                <button key={item.id} className={`chip-button${filterId === item.id ? " active" : ""}`} onClick={() => setFilterId(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
            <button className="primary-button" onClick={async () => {
              const updated = await window.photobooth.sessions.updateConfig({ sessionId: session.id, templateId, filterId });
              setSession(updated);
              updateSessionCollection(updated);
              setStep("ready");
            }}>Pakai template ini</button>
          </div>
        </section>
      )}

      {step === "ready" && session && (
        <section className="ready-layout screen-card">
          <div className="camera-stage">
            <CameraStage videoRef={videoRef} cameraReady={cameraReady} cameraError={cameraError} filterCss={filter.cssFilter} label={cameraLabel} />
          </div>
          <div className="side-panel">
            <p className="eyebrow">KAMERA SIAP</p>
            <h2>Semua sudah masuk frame?</h2>
            <p className="body small">Template ini butuh {template.captureCount} foto. Kamu bisa retake per foto setelah semuanya selesai diambil.</p>
            <div className="detail-list">
              <div><span>Template</span><strong>{template.name}</strong></div>
              <div><span>Filter</span><strong>{filter.label}</strong></div>
              <div><span>Retake</span><strong>{settings.retakeLimitPerPhoto} kali per foto</strong></div>
            </div>
            <div className="dual-actions">
              <button className="secondary-button" onClick={() => setStep("template")}>Kembali</button>
              <button className="primary-button" onClick={beginCapture}>Mulai foto</button>
            </div>
          </div>
        </section>
      )}

      {step === "capture" && session && (
        <section className="capture-layout screen-card">
          <div className="camera-stage full">
            <CameraStage
              videoRef={videoRef}
              cameraReady={cameraReady}
              cameraError={cameraError}
              filterCss={filter.cssFilter}
              label={replaceIndex === null ? `Foto ${captureIndex + 1} dari ${template.captureCount} · ${cameraLabel}` : `Ulangi foto ${replaceIndex + 1} · ${cameraLabel}`}
            />
            <div className="countdown-ring">
              <span>{countdown}</span>
              <small>{replaceIndex === null ? `Foto ${captureIndex + 1} dari ${template.captureCount}` : `Retake foto ${replaceIndex + 1}`}</small>
            </div>
          </div>
          <div className="capture-rail">
            <p className="eyebrow">CAPTURE</p>
            <h2>{replaceIndex === null ? "Ganti gaya tiap hitungan." : "Ambil ulang foto yang dipilih."}</h2>
            <p className="body small">Shutter berlangsung otomatis. Foto yang sudah aman tidak akan hilang saat pergantian pose.</p>
            <ShotRail shots={shots} activeIndex={replaceIndex ?? captureIndex} />
          </div>
        </section>
      )}

      {step === "review" && session && (
        <section className="review-layout screen-card">
          <div className="result-board">
            {session.finalStripDataUrl ? <FinalStripImage dataUrl={session.finalStripDataUrl} /> : <StripShowcase template={template} shots={shots} filterCss={filter.cssFilter} />}
          </div>
          <div className="review-panel">
            <p className="eyebrow">REVIEW</p>
            <h2>Cek hasil strip kamu.</h2>
            <p className="body small">Kalau ada satu foto yang kurang pas, ulangi foto itu saja tanpa mengulang semuanya.</p>
            <div className="shot-list">
              {Array.from({ length: template.captureCount }, (_, index) => {
                const shot = shots.find((item) => item.shotIndex === index);
                const remainingRetake = Math.max(0, settings.retakeLimitPerPhoto - (shot?.attemptsUsed ?? 0));
                return (
                  <div key={index} className="shot-card">
                    <div className="shot-thumb" style={{ background: shot?.color ?? "#2a2d31", filter: filter.cssFilter }}>
                      <span>{shot ? `Foto ${index + 1}` : "Belum ada"}</span>
                    </div>
                    <div className="shot-meta">
                      <strong>Foto {index + 1}</strong>
                      <span>{remainingRetake > 0 ? `${remainingRetake} retake tersisa` : "Retake habis"}</span>
                    </div>
                    <button className="secondary-button small" disabled={!shot || remainingRetake === 0} onClick={() => requestRetake(index)}>
                      Ulangi foto ini
                    </button>
                  </div>
                );
              })}
            </div>
            <button className="primary-button full" onClick={() => void finishReview()}>Gunakan hasil ini</button>
          </div>
        </section>
      )}

      {step === "email" && session && (
        <section className="result-layout screen-card">
          <div className="result-board narrow">
            {session.finalStripDataUrl ? <FinalStripImage dataUrl={session.finalStripDataUrl} /> : <StripShowcase template={template} shots={shots} filterCss={filter.cssFilter} />}
          </div>
          <div className="qr-panel">
            <p className="eyebrow">KIRIM LINK</p>
            <h2>Masukkan email dulu.</h2>
            <p className="body small">Link download hasil photobooth akan dikirim ke email ini lewat Brevo. Setelah itu QR tetap bisa dipindai di layar berikutnya.</p>
            <label className="input-label" htmlFor="recipient-email">Email penerima</label>
            <input
              id="recipient-email"
              className="email-input"
              type="email"
              value={recipientEmail}
              onChange={(event) => {
                setRecipientEmail(event.target.value);
                if (emailError) setEmailError("");
              }}
              placeholder="nama@email.com"
              autoFocus
            />
            {emailError ? <p className="error-text">{emailError}</p> : <p className="operator-help">Contoh: nama@email.com</p>}
            <div className="dual-actions stacked-mobile">
              <button className="secondary-button" onClick={() => setStep("review")}>Kembali</button>
              <button className="primary-button" onClick={() => void submitEmailAndPublish()}>Kirim link</button>
            </div>
          </div>
        </section>
      )}

      {step === "saving" && (
        <section className="saving-layout screen-card centered">
          <div className="saving-orb" />
          <p className="eyebrow">MENYIMPAN</p>
          <h2>Foto kamu sudah aman.</h2>
          <p className="body small">Kami sedang mengunggah hasil dan mengirim link download ke email yang kamu isi.</p>
        </section>
      )}

      {step === "result" && session && (
        <section className="result-layout screen-card">
          <div className="result-board narrow">
            {session.finalStripDataUrl ? <FinalStripImage dataUrl={session.finalStripDataUrl} /> : <StripShowcase template={template} shots={shots} filterCss={filter.cssFilter} />}
          </div>
          <div className="qr-panel">
            <p className="eyebrow">QR SIAP</p>
            <h2>Scan untuk ambil fotomu.</h2>
            <p className="body small">Link hasil sesi {session.id} sudah siap. {session.recipientEmail ? `Kami juga kirim link ini ke ${session.recipientEmail}.` : "Link ini tetap bisa dibuka siapa pun yang punya QR-nya."}</p>
            {qrUrl ? <img className="qr-image" src={qrUrl} alt="QR untuk folder Google Drive sesi photobooth" /> : <div className="qr-placeholder" />}
            <p className="operator-help">{driveStatus.mode === "authenticated" ? "QR ini menuju folder Google Drive asli." : "QR ini akan menuju Cloudflare domain atau fallback yang aktif."}</p>
            <p className="operator-help">{cloudStatus.mode === "configured" ? `Cloudflare aktif di ${cloudStatus.baseUrl}. Publish akan diarahkan ke sana lebih dulu.` : "Cloudflare belum aktif. Publish akan memakai fallback lain."}</p>
            <button className="primary-button full" onClick={resetToWelcome}>Selesai</button>
          </div>
        </section>
      )}

      {operatorOpen && (
        <div className="operator-scrim" onClick={() => setOperatorOpen(false)}>
          <aside className="operator-panel" onClick={(event) => event.stopPropagation()}>
            <div className="operator-header">
              <div>
                <p className="eyebrow">OPERATOR</p>
                <h3>Booth control</h3>
              </div>
              <button className="secondary-button small operator-close" onClick={() => setOperatorOpen(false)}>Tutup</button>
            </div>
            <div className="operator-section">
              <label>Accent color</label>
              <input type="color" value={settings.accentColor} onChange={(event) => void updateAccentColor(event)} />
            </div>
            <div className="operator-section">
              <label>Queue session</label>
              <div className="operator-list">
                <div className="operator-row">
                  <strong>Kamera</strong>
                  <span>{cameraReady ? cameraLabel : cameraError || cameraLabel || "Fallback demo"}</span>
                </div>
                <div className="operator-camera-picker">
                  {cameraSources.map((source) => (
                    <button
                      className={`chip-button${selectedCameraSourceId === source.id ? " active" : ""}`}
                      key={source.id}
                      onClick={() => void changeCameraSource(source.id)}
                    >
                      {source.label}
                    </button>
                  ))}
                </div>
                {queue.length === 0 ? <p>Belum ada sesi yang menunggu link.</p> : queue.map((item) => (
                  <div className="operator-row" key={item.sessionId}>
                    <strong>{item.sessionId}</strong>
                    <span>{item.status}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="operator-section">
              <label>Cloudflare publish</label>
              <div className="operator-list">
                <div className="operator-row">
                  <strong>Status</strong>
                  <span>{cloudStatus.mode === "configured" ? "Aktif" : "Belum aktif"}</span>
                </div>
                <div className="operator-row">
                  <strong>Endpoint</strong>
                  <span>{cloudStatus.baseUrl || "Belum dikonfigurasi"}</span>
                </div>
              </div>
              <p className="operator-help">Publish sesi sekarang diprioritaskan ke Cloudflare Worker pada subdomain photobooth. Google Drive tetap jadi fallback kedua.</p>
            </div>
            <div className="operator-section">
              <label>Email delivery</label>
              <div className="operator-list">
                <div className="operator-row">
                  <strong>Status</strong>
                  <span>Gunakan SMTP Brevo pada desktop app</span>
                </div>
              </div>
              <p className="operator-help">Set env `BREVO_API_KEY`, `BREVO_SMTP_LOGIN`, `BREVO_SENDER_EMAIL`, dan opsional `BREVO_SENDER_NAME` saat menjalankan app. Publish akan mengirim link download lewat SMTP Brevo setelah URL Cloudflare siap.</p>
            </div>
            <div className="operator-section">
              <label>Google Drive</label>
              <div className="operator-list">
                <div className="operator-row">
                  <strong>Status</strong>
                  <span>{driveStatus.mode === "mock" ? "Mock mode" : driveStatus.mode === "configured" ? "Configured" : driveStatus.email || "Authenticated"}</span>
                </div>
                <div className="operator-row">
                  <strong>Root folder</strong>
                  <span>{driveStatus.rootFolderName || "Belum dipilih"}</span>
                </div>
                <div className="operator-row">
                  <strong>Mode QR</strong>
                  <span>{cloudStatus.mode === "configured" ? "Cloudflare domain" : driveStatus.mode === "authenticated" ? "Google Drive nyata" : "Mock link"}</span>
                </div>
              </div>
              <div className="operator-camera-picker">
                <button className="secondary-button small" onClick={() => void signInDrive()}>Login Google</button>
                <button className="secondary-button small" onClick={() => void createDriveRootFolder()}>Buat folder root</button>
                <button className="secondary-button small" onClick={() => void signOutDrive()}>Logout</button>
              </div>
              <p className="operator-help">Set env `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET` sebelum login agar upload folder Drive benar-benar aktif.</p>
            </div>
            <div className="operator-section">
              <label>Riwayat sesi lokal</label>
              <div className="operator-list">
                {allSessions.length === 0 ? <p>Belum ada sesi.</p> : allSessions.slice(0, 5).map((item) => (
                  <div className="operator-row" key={item.id}>
                    <strong>{item.id}</strong>
                    <span>{item.status}</span>
                  </div>
                ))}
              </div>
            </div>
            <button className="secondary-button full" onClick={() => void resetStore()}>Reset demo data</button>
          </aside>
        </div>
      )}
    </main>
  );
}

function sampleShots(count: number): StoredShot[] {
  return Array.from({ length: count }, (_, index) => ({
    shotIndex: index,
    revision: 1,
    attemptsUsed: 0,
    color: `hsl(${(index * 62 + 18) % 360}deg 72% 54%)`,
    capturedAt: new Date().toISOString()
  }));
}

function ShotRail({ shots, activeIndex }: { shots: StoredShot[]; activeIndex: number }) {
  return (
    <div className="shot-rail">
      {Array.from({ length: Math.max(activeIndex + 1, shots.length) }, (_, index) => {
        const shot = shots.find((item) => item.shotIndex === index);
        return (
          <div key={index} className={`shot-rail-item${index === activeIndex ? " active" : ""}`}>
            <div className="shot-rail-color" style={{ background: shot?.color ?? "#232629" }} />
            <span>{shot ? `Foto ${index + 1}` : `Menunggu foto ${index + 1}`}</span>
          </div>
        );
      })}
    </div>
  );
}

function MockCamera({ filterCss, label }: { filterCss: string; label: string }) {
  return (
    <div className="mock-camera" style={{ filter: filterCss }}>
      <div className="mock-person left" />
      <div className="mock-person right" />
      <div className="camera-badge">{label}</div>
    </div>
  );
}

function CameraStage({
  videoRef,
  cameraReady,
  cameraError,
  filterCss,
  label
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  cameraReady: boolean;
  cameraError: string;
  filterCss: string;
  label: string;
}) {
  if (!cameraReady) {
    return <MockCamera filterCss={filterCss} label={cameraError || label} />;
  }

  return (
    <div className="live-camera-shell" style={{ filter: filterCss }}>
      <video ref={videoRef} className="live-camera" muted playsInline />
      <div className="live-camera-overlay">
        <div className="focus-frame" />
        <div className="camera-badge">{label}</div>
      </div>
    </div>
  );
}

function FinalStripImage({ dataUrl }: { dataUrl: string }) {
  return <img className="final-strip-image" src={dataUrl} alt="Hasil strip photobooth" />;
}

function StripShowcase({ template, shots, filterCss, compact = false }: { template: PhotoTemplate; shots: StoredShot[]; filterCss: string; compact?: boolean }) {
  return (
    <div className={`strip-shell ${compact ? " compact" : ""}`} style={{ width: template.width / (compact ? 9.4 : 4.6), height: template.height / (compact ? 9.4 : 4.6) }}>
      {template.slots.map((slot) => {
        const shot = shots.find((item) => item.shotIndex === slot.photoIndex) ?? sampleShots(template.captureCount)[slot.photoIndex];
        return (
          <div
            key={slot.id}
            className="strip-slot"
            style={{
              left: `${(slot.x / template.width) * 100}%`,
              top: `${(slot.y / template.height) * 100}%`,
              width: `${(slot.width / template.width) * 100}%`,
              height: `${(slot.height / template.height) * 100}%`,
              borderRadius: `${slot.cornerRadius}px`,
              transform: `rotate(${slot.rotation}deg)`,
              background: shot.color
            }}
          >
            {shot.dataUrl ? (
              <img className="strip-image" src={shot.dataUrl} alt={`Foto ${slot.photoIndex + 1}`} style={{ filter: filterCss }} />
            ) : (
              <div className="strip-slot-inner" style={{ filter: filterCss }}>
                <span>Foto {slot.photoIndex + 1}</span>
              </div>
            )}
          </div>
        );
      })}
      <div className="strip-overlay">
        <img className="provided-frame" src={providedFrameUrl} alt="Frame photobooth" />
      </div>
    </div>
  );
}
