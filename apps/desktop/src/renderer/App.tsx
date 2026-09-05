import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import frame1Url from "./assets/frames/frame-1.png";
import frame2Url from "./assets/frames/frame-2.png";
import frame3Url from "./assets/frames/frame-3.png";
import frame4Url from "./assets/frames/frame-4.png";
import frame5Url from "./assets/frames/frame-5.png";
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
  type StoredShot,
  type TemplateSlot
} from "@photobooth/domain";

type Step = "welcome" | "template" | "ready" | "capture" | "shot-review" | "review" | "email" | "saving" | "result";

const CAPTURE_INTERVAL_MS = 900;

const frameAssets: Record<string, string> = {
  "frame-1.png": frame1Url,
  "frame-2.png": frame2Url,
  "frame-3.png": frame3Url,
  "frame-4.png": frame4Url,
  "frame-5.png": frame5Url
};

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
  const [lastCapturedIndex, setLastCapturedIndex] = useState<number | null>(null);
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);
  const [retakeCountRecorded, setRetakeCountRecorded] = useState(false);
  const [shutterFlash, setShutterFlash] = useState(false);
  const [queueStatus, setQueueStatus] = useState("Siap memulai sesi baru");
  const [qrUrl, setQrUrl] = useState("");
  const [operatorOpen, setOperatorOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string>("");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraLabel, setCameraLabel] = useState("Kamera belum dipilih");
  const [cameraStatusMessage, setCameraStatusMessage] = useState("Sedang menyiapkan kamera.");
  const [captureError, setCaptureError] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [kioskEnabled, setKioskEnabled] = useState(true);
  const [editorTemplateId, setEditorTemplateId] = useState(templates[0].id);
  const [editorSlotIndex, setEditorSlotIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const captureCycleRef = useRef(0);
  const lastCountdownSoundRef = useRef("");

  const template = useMemo<PhotoTemplate>(() => {
    const base = getTemplate(session?.templateId ?? templateId);
    return { ...base, slots: settings.slotOverrides[base.id] ?? base.slots };
  }, [session?.templateId, settings.slotOverrides, templateId]);
  const editorTemplate = useMemo<PhotoTemplate>(() => {
    const base = getTemplate(editorTemplateId);
    return { ...base, slots: settings.slotOverrides[base.id] ?? base.slots };
  }, [editorTemplateId, settings.slotOverrides]);
  const editorSlot = editorTemplate.slots[editorSlotIndex] ?? editorTemplate.slots[0];
  const filter = useMemo(() => filters.find((item) => item.id === (session?.filterId ?? filterId)) ?? filters[0], [filterId, session?.filterId]);
  const shots = session?.shots ?? [];
  const cameraActive = step === "ready" || step === "capture";

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
    const handleDeviceChange = () => {
      void refreshBrowserCameraSources();
    };
    navigator.mediaDevices?.addEventListener("devicechange", handleDeviceChange);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", handleDeviceChange);
  }, []);

  useEffect(() => {
    if (step !== "capture" || !session) return;
    const usesNativeCamera = selectedCameraSourceId.startsWith("gphoto:");
    if (!usesNativeCamera && !cameraReady) return;

    const soundKey = `${captureCycleRef.current}:${replaceIndex ?? captureIndex}:${countdown}`;
    if (lastCountdownSoundRef.current !== soundKey) {
      lastCountdownSoundRef.current = soundKey;
      playCountdownSound(countdown);
    }

    if (countdown > 1) {
      const timer = window.setTimeout(() => setCountdown((value) => value - 1), CAPTURE_INTERVAL_MS);
      return () => clearTimeout(timer);
    }

    const timer = window.setTimeout(() => {
      const targetIndex = replaceIndex ?? captureIndex;
      const dataUrl = captureFrame();
      if (!selectedCameraSourceId.startsWith("gphoto:") && !dataUrl) {
        setCaptureError("Frame kamera tidak tersedia. Kamera mungkin terputus.");
        setCameraStatusMessage("Kamera terputus saat mengambil foto. Pilih kamera lagi atau kembali.");
        setStep("ready");
        setCountdown(settings.countdownSeconds);
        return;
      }

      playShutterSound();
      setShutterFlash(true);
      window.setTimeout(() => setShutterFlash(false), 140);
      const countAsRetake = replaceIndex !== null && !retakeCountRecorded;
      void window.photobooth.sessions.captureShot({ sessionId: session.id, shotIndex: targetIndex, dataUrl: dataUrl ?? undefined, countAsRetake })
        .then((nextSession) => {
          setSession(nextSession);
          updateSessionCollection(nextSession);
          setCountdown(settings.countdownSeconds);
          setCaptureError("");
          if (countAsRetake) setRetakeCountRecorded(true);
          setLastCapturedIndex(targetIndex);
          setQueueStatus(`Cek hasil foto ${targetIndex + 1} sebelum lanjut.`);
          setStep("shot-review");
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Gagal mengambil foto dari kamera.";
          setCaptureError(message);
          setCameraStatusMessage("Pengambilan foto gagal. Periksa koneksi kamera lalu coba lagi.");
          setQueueStatus("Foto gagal diambil. Kamu bisa memilih ulang kamera atau kembali.");
          setCountdown(settings.countdownSeconds);
          setStep("ready");
        });
    }, CAPTURE_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [cameraReady, captureIndex, countdown, replaceIndex, selectedCameraSourceId, session, settings.countdownSeconds, step, template.captureCount]);

  useEffect(() => {
    if (!cameraActive) {
      stopCamera();
      return;
    }

    void startCamera(selectedCameraSourceId);
    return stopCamera;
  }, [cameraActive, selectedCameraSourceId, step]);

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

  async function refreshBrowserCameraSources() {
    if (!navigator.mediaDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const browserDevices = devices
      .filter((device) => device.kind === "videoinput")
      .map((device, index) => ({ id: `webcam:${device.deviceId}`, label: device.label || `Kamera ${index + 1}` }));
    const nativeSources = await window.photobooth.camera.listSources();
    setCameraSources([
      ...browserDevices,
      ...nativeSources.filter((source) => source.id.startsWith("gphoto:"))
    ]);
  }

  async function startCamera(sourceId = selectedCameraSourceId) {
    if (sourceId.startsWith("gphoto:")) {
      stopCamera();
      const source = cameraSources.find((item) => item.id === sourceId);
      setCameraLabel(source?.label ?? "Canon EOS");
      setCameraReady(false);
      setCameraError("Preview live Canon belum aktif. Capture akan diambil langsung dari kamera.");
      setCameraStatusMessage("Canon siap dipakai untuk jepret langsung, tetapi preview live belum tersedia.");
      return;
    }
    if (!videoRef.current) return;
    stopCamera();
    setCameraError("");
    setCameraStatusMessage("Menghubungkan kamera.");
    try {
      const browserDeviceId = sourceId.startsWith("webcam:") ? sourceId.slice("webcam:".length) : "default";
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(browserDeviceId !== "default" ? { deviceId: { exact: browserDeviceId } } : {}),
          width: { ideal: 2880 },
          height: { ideal: 1440 },
          frameRate: { ideal: 30 }
        },
        audio: false
      });
      streamRef.current = stream;
      const [track] = stream.getVideoTracks();
      const activeDeviceId = track?.getSettings().deviceId;
      setCameraLabel(track?.label || "Kamera aktif");
      setCameraReady(true);
      setCameraError("");
      setCameraStatusMessage("Kamera aktif. Pastikan semua orang sudah masuk frame.");
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      const browserDevices = (await navigator.mediaDevices.enumerateDevices())
        .filter((device) => device.kind === "videoinput")
        .map((device, index) => ({ id: `webcam:${device.deviceId}`, label: device.label || `Kamera ${index + 1}` }));
      setCameraSources((current) => [
        ...browserDevices,
        ...current.filter((source) => source.id.startsWith("gphoto:"))
      ]);
      if (activeDeviceId && sourceId === "webcam:default") {
        const activeSourceId = `webcam:${activeDeviceId}`;
        setSelectedCameraSourceId(activeSourceId);
        await window.photobooth.camera.selectSource(activeSourceId);
      }
    } catch (error) {
      setCameraReady(false);
      setCameraError(error instanceof Error ? error.message : "Kamera tidak tersedia");
      setCameraLabel("Fallback demo");
      setCameraStatusMessage("Kamera belum bisa dipakai. Cek izin kamera atau pilih source lain dari panel operator.");
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
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0 || video.videoHeight === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.98);
  }

  function updateSessionCollection(nextSession: StoredSession) {
    setAllSessions((current) => [nextSession, ...current.filter((item) => item.id !== nextSession.id)]);
  }

  async function startSession() {
    const defaultTemplateId = templates.find((item) => item.id === "frame-3")?.id ?? templates[0].id;
    setTemplateId(defaultTemplateId);
    const nextSession = await window.photobooth.sessions.create({ templateId: defaultTemplateId, filterId });
    setSession(nextSession);
    updateSessionCollection(nextSession);
    setCaptureIndex(0);
    setLastCapturedIndex(null);
    setCountdown(settings.countdownSeconds);
    setReplaceIndex(null);
    setRetakeCountRecorded(false);
    setQrUrl("");
    setRecipientEmail("");
    setEmailError("");
    setQueueStatus("Pilih frame dulu sebelum mulai foto.");
    setStep("template");
  }

  function beginCapture() {
    if (!session) return;
    if (!cameraReady && !selectedCameraSourceId.startsWith("gphoto:")) {
      setQueueStatus("Kamera belum siap. Cek koneksi kamera atau kembali ke layar sebelumnya.");
      return;
    }
    unlockAudio();
    captureCycleRef.current += 1;
    setCaptureIndex(0);
    setCountdown(settings.countdownSeconds);
    setQueueStatus(`Ambil ${template.captureCount} foto untuk template ${template.name}.`);
    setStep("capture");
  }

  function requestRetake(shotIndex: number) {
    unlockAudio();
    captureCycleRef.current += 1;
    setReplaceIndex(shotIndex);
    setRetakeCountRecorded(false);
    setCountdown(settings.countdownSeconds);
    setQueueStatus(`Mengulang foto ${shotIndex + 1}.`);
    setStep("capture");
  }

  function acceptCapturedShot() {
    if (lastCapturedIndex === null) return;
    if (replaceIndex !== null) {
      setReplaceIndex(null);
      setRetakeCountRecorded(false);
      setLastCapturedIndex(null);
      setQueueStatus(`Foto ${lastCapturedIndex + 1} berhasil diganti.`);
      setStep("review");
      return;
    }

    if (lastCapturedIndex + 1 >= template.captureCount) {
      setLastCapturedIndex(null);
      setQueueStatus("Semua foto sudah diambil. Cek hasil strip kamu.");
      setStep("review");
      return;
    }

    const nextIndex = lastCapturedIndex + 1;
    unlockAudio();
    captureCycleRef.current += 1;
    setCaptureIndex(nextIndex);
    setLastCapturedIndex(null);
    setCountdown(settings.countdownSeconds);
    setQueueStatus(`Siap untuk foto ${nextIndex + 1}.`);
    setStep("capture");
  }

  function rejectCapturedShot() {
    const targetIndex = lastCapturedIndex ?? replaceIndex ?? captureIndex;
    unlockAudio();
    captureCycleRef.current += 1;
    setCaptureIndex(targetIndex);
    setLastCapturedIndex(null);
    setCountdown(settings.countdownSeconds);
    setQueueStatus(`Foto ${targetIndex + 1} dibatalkan. Ambil ulang sekarang.`);
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
    setRetakeCountRecorded(false);
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
    setCaptureError("");
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

  async function toggleKiosk(value: boolean) {
    const result = await window.photobooth.system.setKiosk(value);
    setKioskEnabled(result.kiosk);
  }

  function unlockAudio() {
    const AudioContextConstructor = window.AudioContext;
    const context = audioContextRef.current ?? new AudioContextConstructor();
    audioContextRef.current = context;
    if (context.state === "suspended") void context.resume();
  }

  function playCountdownSound(value: number) {
    unlockAudio();
    const context = audioContextRef.current;
    if (!context) return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(value === 1 ? 1040 : 760, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(value === 1 ? 0.2 : 0.14, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (value === 1 ? 0.18 : 0.12));
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.2);
  }

  function playShutterSound() {
    unlockAudio();
    const context = audioContextRef.current;
    if (!context) return;
    const now = context.currentTime;
    const sampleCount = Math.floor(context.sampleRate * 0.16);
    const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < sampleCount; index += 1) {
      const envelope = Math.exp((-index / sampleCount) * 10);
      samples[index] = (Math.random() * 2 - 1) * envelope;
    }

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1500, now);
    filter.Q.setValueAtTime(0.8, now);
    gain.gain.setValueAtTime(0.34, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.start(now);
    source.stop(now + 0.17);

    const click = context.createOscillator();
    const clickGain = context.createGain();
    click.type = "square";
    click.frequency.setValueAtTime(180, now);
    click.frequency.exponentialRampToValueAtTime(70, now + 0.06);
    clickGain.gain.setValueAtTime(0.16, now);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    click.connect(clickGain);
    clickGain.connect(context.destination);
    click.start(now);
    click.stop(now + 0.08);
  }

  async function updateEditorSlot(changes: Partial<TemplateSlot>) {
    const slots = editorTemplate.slots.map((slot, index) => index === editorSlotIndex ? { ...slot, ...changes } : slot);
    const next = await window.photobooth.settings.update({
      slotOverrides: { ...settings.slotOverrides, [editorTemplate.id]: slots }
    });
    setSettings(next);
  }

  async function resetEditorSlots() {
    const { [editorTemplate.id]: _removed, ...slotOverrides } = settings.slotOverrides;
    const next = await window.photobooth.settings.update({ slotOverrides });
    setSettings(next);
  }

  return (
    <main className="app-shell" style={{ ["--accent-color" as string]: settings.accentColor }}>
      <header className="topbar">
        <div className="topbar-branding">
          <p className="topbar-label">PHOT OBOOTH</p>
          <strong className="brand">{settings.eventName}</strong>
        </div>
        <div className="topbar-meta">
          <span className="status-pill"><i /> {cameraReady || selectedCameraSourceId.startsWith("gphoto:") ? "Kamera siap" : "Cek kamera"}</span>
          <span className="status-pill muted compact-status">{queueStatus}</span>
          <button className="secondary-button operator-toggle" onClick={() => setOperatorOpen(true)}>Operator</button>
        </div>
      </header>

      {step === "welcome" && (
        <section className="welcome-layout screen-card">
          <div className="copy-column">
            <p className="eyebrow">EVENT KIOSK</p>
            <h1>Siap bikin strip 6 foto yang langsung bisa dikirim?</h1>
            <p className="body">Setelah selesai foto, tamu isi email lalu link hasil otomatis dikirim dan tetap tersedia lewat QR.</p>
            <div className="welcome-actions">
              <button className="primary-button" onClick={() => void startSession()}>Mulai</button>
            </div>
          </div>
          <StripShowcase template={template} shots={sampleShots(template.captureCount)} filterCss={filter.cssFilter} />
        </section>
      )}

      {step === "template" && session && (
        <section className="screen-card stack-gap compact-template-step">
          <div className="section-head compact-head">
            <div>
              <p className="eyebrow">PILIH FRAME</p>
              <h2>Pilih frame yang paling cocok.</h2>
            </div>
            <p className="body small">Semua frame memakai 6 foto. Pilih satu dulu, lalu lanjut ke kamera.</p>
          </div>
          <div className="template-grid compact-template-grid">
            {templates.map((item) => {
              const selected = item.id === templateId;
              const previewTemplate = { ...item, slots: settings.slotOverrides[item.id] ?? item.slots };
              return (
                <button
                  key={item.id}
                  className={`template-card compact-template-card${selected ? " selected" : ""}`}
                  onClick={() => setTemplateId(item.id)}
                  aria-label={`Pilih ${item.name}`}
                  aria-pressed={selected}
                >
                  <StripShowcase template={previewTemplate} shots={sampleShots(item.captureCount)} filterCss={filter.cssFilter} picker />
                </button>
              );
            })}
          </div>
          <div className="action-row compact-actions">
            <div className="filter-row">
              {filters.map((item) => (
                <button key={item.id} className={`chip-button${filterId === item.id ? " active" : ""}`} onClick={() => setFilterId(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
            <div className="dual-actions compact-dual-actions">
              <button className="secondary-button" onClick={resetToWelcome}>Kembali</button>
              <button className="primary-button" onClick={async () => {
                const updated = await window.photobooth.sessions.updateConfig({ sessionId: session.id, templateId, filterId });
                setSession(updated);
                updateSessionCollection(updated);
                setQueueStatus(`${getTemplate(templateId).name} siap dipakai.`);
                setStep("ready");
              }}>Pakai frame ini</button>
            </div>
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
            <p className="body small">Frame default memakai {template.captureCount} foto. Kalau kamera belum siap, kamu tetap bisa kembali dan ganti source kamera dari operator.</p>
            <div className="detail-list">
              <div><span>Template</span><strong>{template.name}</strong></div>
              <div><span>Filter</span><strong>{filter.label}</strong></div>
              <div><span>Retake</span><strong>{settings.retakeLimitPerPhoto} kali per foto</strong></div>
            </div>
            <label className="camera-select-label" htmlFor="guest-camera-source">Pilih kamera</label>
            <select
              id="guest-camera-source"
              className="camera-source-select"
              value={selectedCameraSourceId}
              onChange={(event) => void changeCameraSource(event.target.value)}
            >
              {cameraSources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
            </select>
            <div className="camera-status-card">
              <strong>{cameraReady ? "Kamera siap" : selectedCameraSourceId.startsWith("gphoto:") ? "Canon mode" : "Kamera belum siap"}</strong>
              <span>{cameraStatusMessage}</span>
            </div>
            {!cameraReady && !selectedCameraSourceId.startsWith("gphoto:") && (
              <div className="inline-warning">
                <strong>Kamera belum aktif.</strong>
                <span>Cek izin kamera atau buka operator untuk pilih source lain.</span>
              </div>
            )}
            {captureError && <div className="inline-warning"><strong>Foto belum berhasil.</strong><span>{captureError}</span></div>}
            <div className="dual-actions">
              <button className="secondary-button" onClick={() => setStep("template")}>Kembali</button>
              <button className="primary-button" onClick={beginCapture} disabled={!cameraReady && !selectedCameraSourceId.startsWith("gphoto:")}>Mulai foto</button>
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
              <span>{cameraReady || selectedCameraSourceId.startsWith("gphoto:") ? countdown : "·"}</span>
              <small>{cameraReady || selectedCameraSourceId.startsWith("gphoto:") ? (replaceIndex === null ? `Foto ${captureIndex + 1} dari ${template.captureCount}` : `Retake foto ${replaceIndex + 1}`) : "Menunggu kamera"}</small>
            </div>
          </div>
          <div className="capture-rail">
            <p className="eyebrow">CAPTURE</p>
            <h2>{replaceIndex === null ? "Ganti gaya tiap hitungan." : "Ambil ulang foto yang dipilih."}</h2>
            <p className="body small">Shutter berlangsung otomatis. Tiap foto yang sudah aman langsung masuk ke strip dan tidak hilang saat pergantian pose.</p>
            <div className="capture-status-card">
              <strong>{replaceIndex === null ? `Pose ${captureIndex + 1} dari ${template.captureCount}` : `Retake foto ${replaceIndex + 1}`}</strong>
              <span>{!cameraReady && !selectedCameraSourceId.startsWith("gphoto:") ? "Menghubungkan kembali stream kamera." : countdown > 1 ? `Bersiap, foto akan diambil dalam ${countdown} detik.` : "Jepret sekarang."}</span>
            </div>
            <ShotRail shots={shots} activeIndex={replaceIndex ?? captureIndex} />
            <button className="secondary-button full" onClick={() => setStep("ready")}>Kembali ke kamera</button>
          </div>
        </section>
      )}

      {step === "shot-review" && session && lastCapturedIndex !== null && (
        <section className="shot-review-layout screen-card">
          <div className="single-shot-preview">
            {shots.find((shot) => shot.shotIndex === lastCapturedIndex)?.dataUrl ? (
              <img
                src={shots.find((shot) => shot.shotIndex === lastCapturedIndex)?.dataUrl}
                alt={`Preview foto ${lastCapturedIndex + 1}`}
                style={{ filter: filter.cssFilter }}
              />
            ) : (
              <div className="camera-empty-state"><strong>Preview belum tersedia</strong></div>
            )}
          </div>
          <div className="shot-review-panel">
            <p className="eyebrow">CEK FOTO {lastCapturedIndex + 1}</p>
            <h2>Mau pakai foto ini?</h2>
            <p className="body small">Kalau sudah pas, lanjut ke pose berikutnya. Kalau belum, batalkan dan ambil ulang foto yang sama.</p>
            <div className="shot-review-progress">
              {Array.from({ length: template.captureCount }, (_, index) => (
                <span key={index} className={index <= lastCapturedIndex ? "filled" : ""}>{index + 1}</span>
              ))}
            </div>
            <div className="shot-review-actions">
              <button className="secondary-button" onClick={rejectCapturedShot}>Ulang</button>
              <button className="primary-button" onClick={acceptCapturedShot}>
                {replaceIndex !== null || lastCapturedIndex + 1 >= template.captureCount ? "Pakai" : "Next"}
              </button>
            </div>
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
            <div className="panel-footer">
              <div className="footer-note">
                <strong>{template.captureCount} foto terpasang</strong>
                <span>Lanjutkan untuk kirim link ke email tamu.</span>
              </div>
              <button className="primary-button full" onClick={() => void finishReview()}>Lanjut kirim link</button>
            </div>
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
            <div className="panel-footer compact">
              <div className="footer-note">
                <strong>Email tamu</strong>
                <span>Link hasil akan tetap tersedia juga lewat QR.</span>
              </div>
              <div className="dual-actions stacked-mobile">
                <button className="secondary-button" onClick={() => setStep("review")}>Kembali</button>
                <button className="primary-button" onClick={() => void submitEmailAndPublish()}>Kirim link</button>
              </div>
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
            <div className="panel-footer compact">
              <div className="footer-note">
                <strong>Hasil siap diambil</strong>
                <span>Scan QR atau cek email yang tadi sudah diisi.</span>
              </div>
              <button className="primary-button full" onClick={resetToWelcome}>Selesai</button>
            </div>
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
                <p className="operator-help">Atur kamera, publish, dan mode kiosk tanpa mengganggu alur tamu.</p>
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
                <div className="operator-row">
                  <strong>Kiosk</strong>
                  <span>{kioskEnabled ? "Aktif" : "Nonaktif"}</span>
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
                <div className="operator-camera-picker">
                  <button className="secondary-button small" onClick={() => void toggleKiosk(true)}>Aktifkan kiosk</button>
                  <button className="secondary-button small" onClick={() => void toggleKiosk(false)}>Keluar kiosk</button>
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
            <div className="operator-section slot-editor-section">
              <label>Editor posisi foto</label>
              <div className="slot-editor-layout">
                <div className="slot-editor-preview">
                  <StripShowcase
                    template={editorTemplate}
                    shots={sampleShots(editorTemplate.captureCount)}
                    filterCss="none"
                    compact
                    selectedSlotIndex={editorSlotIndex}
                  />
                </div>
                <div className="slot-editor-controls">
                  <select value={editorTemplateId} onChange={(event) => { setEditorTemplateId(event.target.value); setEditorSlotIndex(0); }}>
                    {templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  <div className="slot-selector">
                    {editorTemplate.slots.map((slot, index) => (
                      <button key={slot.id} className={`chip-button${editorSlotIndex === index ? " active" : ""}`} onClick={() => setEditorSlotIndex(index)}>
                        {index + 1}
                      </button>
                    ))}
                  </div>
                  <div className="slot-fields">
                    {(["x", "y", "width", "height", "cornerRadius"] as const).map((field) => (
                      <label key={field}>
                        <span>{field === "cornerRadius" ? "Radius" : field.toUpperCase()}</span>
                        <input
                          type="number"
                          min="0"
                          value={editorSlot[field]}
                          onChange={(event) => void updateEditorSlot({ [field]: Number(event.target.value) })}
                        />
                      </label>
                    ))}
                  </div>
                  <button className="secondary-button small" onClick={() => void resetEditorSlots()}>Reset posisi frame</button>
                </div>
              </div>
            </div>
            <button className="secondary-button full" onClick={() => void resetStore()}>Reset demo data</button>
          </aside>
        </div>
      )}
      {shutterFlash && <div className="shutter-flash" aria-hidden="true" />}
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
  return (
    <div className={`live-camera-shell${cameraReady ? " ready" : " waiting"}`} style={{ filter: filterCss }}>
      <video ref={videoRef} className="live-camera" muted playsInline autoPlay />
      {!cameraReady && (
        <div className="camera-empty-state">
          <div className="camera-empty-mark" aria-hidden="true" />
          <strong>Preview belum aktif</strong>
          <span>{cameraError || "Sedang menghubungkan kamera."}</span>
        </div>
      )}
      {cameraReady && (
        <div className="live-camera-overlay">
          <div className="focus-frame" />
          <div className="camera-badge">{label}</div>
        </div>
      )}
    </div>
  );
}

function FinalStripImage({ dataUrl }: { dataUrl: string }) {
  return <img className="final-strip-image" src={dataUrl} alt="Hasil strip photobooth" />;
}

function StripShowcase({ template, shots, filterCss, compact = false, picker = false, selectedSlotIndex }: { template: PhotoTemplate; shots: StoredShot[]; filterCss: string; compact?: boolean; picker?: boolean; selectedSlotIndex?: number }) {
  const overlayUrl = frameAssets[template.overlayAsset] ?? frame3Url;
  const displayHeight = picker ? 330 : compact ? 138 : 520;
  const displayWidth = displayHeight * (template.width / template.height);
  return (
    <div className={`strip-shell ${compact || picker ? " compact" : ""}`} style={{ width: displayWidth, height: displayHeight }}>
      {template.slots.map((slot, slotIndex) => {
        const shot = shots.find((item) => item.shotIndex === slot.photoIndex) ?? sampleShots(template.captureCount)[slot.photoIndex];
        return (
          <div
            key={slot.id}
            className={`strip-slot${selectedSlotIndex === slotIndex ? " editing" : ""}`}
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
        <img className="provided-frame" src={overlayUrl} alt={template.name} />
      </div>
    </div>
  );
}
