import { useCallback, useEffect, useRef, useState } from "react";
import "./CameraCapture.css";

/**
 * CameraCapture
 * Props:
 *   onCapture(file, previewUrl) — called when user confirms a photo
 *   onClose()                  — called when user dismisses the camera
 */
export default function CameraCapture({ onCapture, onClose }) {
  // ── state ──────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState("idle"); // idle | requesting | live | captured | recording | recorded | error
  const [errorMsg, setErrorMsg] = useState("");
  const [devices, setDevices] = useState([]);       // available video input devices
  const [deviceIdx, setDeviceIdx] = useState(0);    // which device is active
  const [facingMode, setFacingMode] = useState("environment"); // environment | user
  const [capturedUrl, setCapturedUrl] = useState(null);
  const [capturedFile, setCapturedFile] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedUrl, setRecordedUrl] = useState(null);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [recSeconds, setRecSeconds] = useState(0);
  const [mode, setMode] = useState("photo"); // photo | video
  const [camLoading, setCamLoading] = useState(false);

  // ── refs ───────────────────────────────────────────────────────────────────
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const mediaRecRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);

  // ── helpers ────────────────────────────────────────────────────────────────
  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function stopRecordingTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  // ── enumerate devices ──────────────────────────────────────────────────────
  async function enumerateDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const vids = all.filter(d => d.kind === "videoinput");
      setDevices(vids);
      return vids;
    } catch { return []; }
  }

  // ── start camera ───────────────────────────────────────────────────────────
  const startCamera = useCallback(async (overrideFacing, overrideIdx) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMsg("Your browser does not support camera access. Try Chrome or Safari on HTTPS / localhost.");
      setPhase("error"); return;
    }
    setCamLoading(true);
    setPhase("requesting");
    stopStream();

    const vids = await enumerateDevices();
    const facing = overrideFacing ?? facingMode;
    const idx    = overrideIdx   ?? deviceIdx;

    // Build constraints — prefer facingMode on mobile, deviceId on desktop
    let constraints;
    if (vids.length > 1 && vids[idx]?.deviceId) {
      constraints = { video: { deviceId: { exact: vids[idx].deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
    } else {
      constraints = { video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      // Don't touch videoRef here — the <video> element may not be in the DOM yet.
      // useEffect below attaches the stream once phase === "live" renders the element.
      setPhase("live");
      setCamLoading(false);
    } catch (err) {
      setCamLoading(false);
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setErrorMsg("Camera permission denied. Please allow camera access in your browser settings and try again.");
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        setErrorMsg("No camera found on this device.");
      } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
        setErrorMsg("Camera is already in use by another application. Close it and try again.");
      } else if (err.name === "OverconstrainedError") {
        // Retry without deviceId constraint
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false });
          streamRef.current = stream;
          setPhase("live"); setCamLoading(false); return;
        } catch { /* fall through */ }
        setErrorMsg("Camera constraint not supported on this device.");
      } else {
        setErrorMsg(`Camera error: ${err.message || err.name}`);
      }
      setPhase("error");
    }
  }, [facingMode, deviceIdx]);

  // ── switch camera ──────────────────────────────────────────────────────────
  async function switchCamera() {
    const vids = devices.length ? devices : await enumerateDevices();
    if (vids.length > 1) {
      const next = (deviceIdx + 1) % vids.length;
      setDeviceIdx(next);
      await startCamera(facingMode, next);
    } else {
      const next = facingMode === "environment" ? "user" : "environment";
      setFacingMode(next);
      await startCamera(next, deviceIdx);
    }
  }

  // ── capture photo ──────────────────────────────────────────────────────────
  function capturePhoto() {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width  = video.videoWidth  || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (!blob) return;
      const file = new File([blob], `road_capture_${Date.now()}.jpg`, { type: "image/jpeg" });
      const url  = URL.createObjectURL(blob);
      setCapturedFile(file);
      setCapturedUrl(url);
      stopStream();
      setPhase("captured");
    }, "image/jpeg", 0.92);
  }

  // ── retake ─────────────────────────────────────────────────────────────────
  function retake() {
    if (capturedUrl) { URL.revokeObjectURL(capturedUrl); setCapturedUrl(null); }
    setCapturedFile(null);
    startCamera();
  }

  // ── confirm photo ──────────────────────────────────────────────────────────
  function confirmPhoto() {
    if (capturedFile && capturedUrl) onCapture(capturedFile, capturedUrl);
  }

  // ── video recording ────────────────────────────────────────────────────────
  function startRecording() {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : "video/mp4";
    try {
      const mr = new MediaRecorder(streamRef.current, { mimeType });
      mr.ondataavailable = e => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setRecordedBlob(blob);
        setRecordedUrl(URL.createObjectURL(blob));
        stopStream();
        setPhase("recorded");
        stopRecordingTimer();
      };
      mr.start(200);
      mediaRecRef.current = mr;
      setIsRecording(true);
      setRecSeconds(0);
      setPhase("recording");
      timerRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000);
    } catch (err) {
      setErrorMsg(`Recording failed: ${err.message}`);
      setPhase("error");
    }
  }

  function stopRecording() {
    if (mediaRecRef.current?.state !== "inactive") mediaRecRef.current?.stop();
    setIsRecording(false);
    stopRecordingTimer();
  }

  function retakeVideo() {
    if (recordedUrl) { URL.revokeObjectURL(recordedUrl); setRecordedUrl(null); }
    setRecordedBlob(null);
    startCamera();
  }

  // ── attach stream to <video> AFTER it mounts in the DOM ──────────────────
  useEffect(() => {
    if ((phase === "live" || phase === "recording") && videoRef.current && streamRef.current) {
      const video = videoRef.current;
      if (video.srcObject !== streamRef.current) {
        video.srcObject = streamRef.current;
      }
      video.play().catch(() => {});
    }
  }, [phase]);

  // ── cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopStream();
      stopRecordingTimer();
      if (capturedUrl) URL.revokeObjectURL(capturedUrl);
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
  }, []); // eslint-disable-line

  // ── format seconds ─────────────────────────────────────────────────────────
  function fmtTime(s) { return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="cam-overlay">
      <div className="cam-modal">

        {/* ── Header ── */}
        <div className="cam-header">
          <div>
            <span className="cam-eyebrow">LIVE CAMERA · ROAD CAPTURE</span>
            <h3>Camera</h3>
          </div>
          <div className="cam-header-right">
            {/* Mode toggle — only when live or idle */}
            {(phase === "live" || phase === "idle") && (
              <div className="cam-mode-toggle">
                <button className={mode === "photo" ? "active" : ""} onClick={() => setMode("photo")}>Photo</button>
                <button className={mode === "video" ? "active" : ""} onClick={() => setMode("video")}>Video</button>
              </div>
            )}
            <button className="cam-close" onClick={() => { stopStream(); stopRecordingTimer(); onClose(); }}>✕</button>
          </div>
        </div>

        {/* ── Idle ── */}
        {phase === "idle" && (
          <div className="cam-idle">
            <div className="cam-idle-icon">◎</div>
            <p>Camera is off. Click below to start.</p>
            <button className="cam-btn cam-btn-primary" onClick={() => startCamera()}>
              ◎ Open Camera
            </button>
          </div>
        )}

        {/* ── Requesting / Loading ── */}
        {(phase === "requesting" || camLoading) && phase !== "error" && (
          <div className="cam-idle">
            <div className="cam-spinner" />
            <p>Starting camera…</p>
          </div>
        )}

        {/* ── Error ── */}
        {phase === "error" && (
          <div className="cam-error">
            <div className="cam-error-icon">⚠</div>
            <p>{errorMsg}</p>
            <div className="cam-error-actions">
              <button className="cam-btn cam-btn-primary" onClick={() => { setPhase("idle"); setErrorMsg(""); }}>
                Try Again
              </button>
              <button className="cam-btn" onClick={() => { stopStream(); onClose(); }}>Close</button>
            </div>
          </div>
        )}

        {/* ── Live preview ── */}
        {(phase === "live" || phase === "recording") && (
          <div className="cam-live">
            <div className="cam-video-wrap">
              <video ref={videoRef} autoPlay playsInline muted className="cam-video" />
              {phase === "recording" && (
                <div className="cam-rec-badge">● REC {fmtTime(recSeconds)}</div>
              )}
            </div>

            <div className="cam-controls">
              {/* Switch camera */}
              <button className="cam-btn cam-btn-icon" title="Switch camera" onClick={switchCamera}>⇄</button>

              {/* Main action */}
              {mode === "photo" ? (
                <button className="cam-btn cam-btn-capture" onClick={capturePhoto} title="Capture photo">
                  <span className="cam-shutter" />
                </button>
              ) : (
                !isRecording ? (
                  <button className="cam-btn cam-btn-capture cam-btn-rec" onClick={startRecording} title="Start recording">
                    <span className="cam-rec-dot" />
                  </button>
                ) : (
                  <button className="cam-btn cam-btn-capture cam-btn-stop" onClick={stopRecording} title="Stop recording">
                    <span className="cam-stop-sq" />
                  </button>
                )
              )}

              {/* Turn off */}
              <button className="cam-btn cam-btn-icon" title="Turn off camera" onClick={() => { stopStream(); setPhase("idle"); }}>⏻</button>
            </div>

            <p className="cam-hint">
              {mode === "photo" ? "Point camera at road surface and press the shutter button." : isRecording ? "Recording in progress. Press stop when done." : "Press the record button to start video capture."}
            </p>
          </div>
        )}

        {/* ── Captured photo ── */}
        {phase === "captured" && capturedUrl && (
          <div className="cam-captured">
            <p className="cam-captured-label">Captured Road Image</p>
            <img src={capturedUrl} alt="Captured road" className="cam-captured-img" />
            <div className="cam-captured-actions">
              <button className="cam-btn" onClick={retake}>↺ Retake</button>
              <button className="cam-btn cam-btn-primary" onClick={confirmPhoto}>✓ Use This Photo</button>
            </div>
          </div>
        )}

        {/* ── Recorded video ── */}
        {phase === "recorded" && recordedUrl && (
          <div className="cam-captured">
            <p className="cam-captured-label">Recorded Video Preview</p>
            <video src={recordedUrl} controls className="cam-captured-img" />
            <div className="cam-video-note">
              <span>⚑</span>
              <span>Video recording is available. Video AI analysis is not yet implemented — only image scans are supported by the current YOLO backend. Submit a photo for AI detection.</span>
            </div>
            <div className="cam-captured-actions">
              <button className="cam-btn" onClick={retakeVideo}>↺ Retake</button>
              <button className="cam-btn" onClick={() => { stopStream(); onClose(); }}>Close</button>
            </div>
          </div>
        )}

        {/* Hidden canvas for capture */}
        <canvas ref={canvasRef} style={{ display: "none" }} />
      </div>
    </div>
  );
}
