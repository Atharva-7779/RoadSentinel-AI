import { useEffect, useRef, useState } from "react";
import "./RoadScanner.css";
import CameraCapture from "./CameraCapture";

const API_BASE = (
  import.meta.env.VITE_API_URL || "http://127.0.0.1:5001"
).replace(/\/$/, "");

const SEVERITY_COLOR = { High: "#ff5c6a", Medium: "#ffb347", Low: "#42d69a" };
const DAMAGE_LABELS = {
  pothole: "Pothole",
  longitudinal_crack: "Longitudinal Crack",
  transverse_crack: "Transverse Crack",
  alligator_crack: "Alligator Crack",
  waterlogging: "Waterlogging",
  repaired_patch: "Repaired Patch",
  road_edge_damage: "Road Edge Damage",
};
const DAMAGE_DESC = {
  pothole: "Bowl-shaped depression in road surface. High vehicle damage risk.",
  longitudinal_crack: "Crack running parallel to road direction. Indicates structural fatigue.",
  transverse_crack: "Crack perpendicular to road. Often caused by thermal stress.",
  alligator_crack: "Interconnected cracks resembling alligator skin. Severe structural failure.",
  waterlogging: "Standing water on road surface. Accelerates pavement deterioration.",
  repaired_patch: "Previously repaired area. Monitor for re-deterioration.",
  road_edge_damage: "Damage at road edges. Risk of road widening failure.",
};

function HealthGauge({ score }) {
  const color = score >= 70 ? "#42d69a" : score >= 45 ? "#ffb347" : "#ff5c6a";
  const label = score >= 70 ? "Good" : score >= 45 ? "Fair" : "Poor";
  const r = 44, cx = 54, cy = 54;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div className="gauge-wrap">
      <svg width="108" height="108" viewBox="0 0 108 108">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1a2a3a" strokeWidth="10" />
        <circle
          cx={cx} cy={cy} r={r} fill="none"
          stroke={color} strokeWidth="10"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: "stroke-dasharray 0.8s ease" }}
        />
        <text x={cx} y={cy - 4} textAnchor="middle" fill={color} fontSize="18" fontWeight="700">{score}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fill="#8494aa" fontSize="9">{label}</text>
      </svg>
      <span style={{ color, fontSize: 11, fontWeight: 600 }}>Road Health Score</span>
    </div>
  );
}

function SeverityBar({ label, count, total, color }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="sev-bar-row">
      <span>{label}</span>
      <div className="sev-bar-track">
        <div className="sev-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span>{count}</span>
    </div>
  );
}

function computeHealthScore(detections) {
  if (!detections || detections.length === 0) return 95;
  const weights = { High: 18, Medium: 9, Low: 4 };
  const penalty = detections.reduce((acc, d) => acc + (weights[d.severity] || 6), 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

function computeRiskCategory(score) {
  if (score >= 80) return { label: "Low Risk", color: "#42d69a", bg: "#0d2a1e" };
  if (score >= 60) return { label: "Moderate Risk", color: "#ffb347", bg: "#2a1e0a" };
  if (score >= 40) return { label: "High Risk", color: "#ff8c42", bg: "#2a1508" };
  return { label: "Critical Risk", color: "#ff5c6a", bg: "#2a0d12" };
}

function computeRepairPriority(detections) {
  if (!detections || detections.length === 0) return { level: "None", action: "No repair needed", urgency: "—" };
  const hasHigh = detections.some(d => d.severity === "High");
  const hasMed = detections.some(d => d.severity === "Medium");
  const highCount = detections.filter(d => d.severity === "High").length;
  if (highCount >= 3 || detections.some(d => d.damage === "alligator_crack"))
    return { level: "P1 — Immediate", action: "Emergency patching required within 48 hours", urgency: "URGENT" };
  if (hasHigh)
    return { level: "P2 — High", action: "Schedule repair within 1–2 weeks", urgency: "HIGH" };
  if (hasMed)
    return { level: "P3 — Medium", action: "Plan repair within 1 month", urgency: "MEDIUM" };
  return { level: "P4 — Low", action: "Monitor and include in next maintenance cycle", urgency: "LOW" };
}

function computeCauses(detections) {
  if (!detections || detections.length === 0) return [];
  const causes = new Set();
  detections.forEach(d => {
    if (d.damage === "pothole" || d.damage === "alligator_crack") {
      causes.add("Heavy traffic load exceeding pavement design capacity");
      causes.add("Water infiltration weakening sub-base layers");
    }
    if (d.damage === "longitudinal_crack" || d.damage === "transverse_crack") {
      causes.add("Thermal expansion and contraction stress cycles");
      causes.add("Pavement aging and material fatigue");
    }
    if (d.damage === "waterlogging") {
      causes.add("Blocked or inadequate drainage infrastructure");
      causes.add("Road camber loss reducing water runoff");
    }
    if (d.damage === "road_edge_damage") {
      causes.add("Shoulder erosion and edge support failure");
      causes.add("Heavy vehicle overloading near road edges");
    }
    if (d.damage === "repaired_patch") {
      causes.add("Previous repair using incompatible materials");
    }
  });
  return [...causes].slice(0, 4);
}

export default function RoadScanner() {
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [activeTab, setActiveTab] = useState("results");
  const [gpsLoading, setGpsLoading] = useState(false);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [inputMode, setInputMode] = useState("upload"); // upload | camera
  const [showCamera, setShowCamera] = useState(false);
  const fileRef = useRef();

  function handlePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setMessage("Please select a valid image."); return; }
    if (file.size > 10 * 1024 * 1024) { setMessage("Image must be under 10 MB."); return; }
    if (preview) URL.revokeObjectURL(preview);
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
    setMessage("");
    setScanResult(null);
  }

  function removePhoto() {
    if (preview) URL.revokeObjectURL(preview);
    setPhoto(null); setPreview(""); setMessage(""); setScanResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function getGPS() {
    if (!navigator.geolocation) { setMessage("GPS not supported."); return; }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setGpsLoading(false);
        setMessage("GPS captured.");
      },
      () => { setMessage("GPS unavailable. Enter manually."); setGpsLoading(false); }
    );
  }

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/map/data`);
      const d = await r.json();
      if (d.success) setHistory((d.aiDetections || []).slice(0, 8));
    } catch { /* silent */ }
    setHistoryLoading(false);
  }

  useEffect(() => { loadHistory(); }, []);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function analyzeRoad() {
    if (!photo) { setMessage("Please upload a road image first."); return; }
    setLoading(true); setMessage(""); setScanResult(null);
    try {
      const fd = new FormData();
      fd.append("photo", photo);
      if (lat && lng) { fd.append("latitude", lat); fd.append("longitude", lng); }
      if (locationLabel) fd.append("locationLabel", locationLabel);

      const res = await fetch(`${API_BASE}/api/scan`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.success) {
        removePhoto();
        throw new Error(data.message || "AI scanning failed.");
      }
      setScanResult(data);
      setMessage("Analysis complete.");
      setActiveTab("results");
      loadHistory();
    } catch (err) {
      setMessage(err.message || "Could not connect to AI server.");
    } finally {
      setLoading(false);
    }
  }

  const healthScore = scanResult ? computeHealthScore(scanResult.detections) : null;
  const riskCat = healthScore !== null ? computeRiskCategory(healthScore) : null;
  const priority = scanResult ? computeRepairPriority(scanResult.detections) : null;
  const causes = scanResult ? computeCauses(scanResult.detections) : [];
  const highCount = scanResult ? scanResult.detections.filter(d => d.severity === "High").length : 0;
  const medCount = scanResult ? scanResult.detections.filter(d => d.severity === "Medium").length : 0;
  const lowCount = scanResult ? scanResult.detections.filter(d => d.severity === "Low").length : 0;

  return (
    <div className="scanner-page">
      {/* Header */}
      <div className="scanner-intro">
        <div>
          <span className="scanner-eyebrow">COMPUTER VISION · YOLO v8 · ROAD ANALYSIS</span>
          <h2>AI Road Damage Scanner</h2>
          <p>Upload a road image for full AI-powered damage detection, health scoring, and repair intelligence.</p>
        </div>
        <span className="scanner-status">● {loading ? "ANALYZING…" : "SCANNER READY"}</span>
      </div>

      {/* Camera modal */}
      {showCamera && (
        <CameraCapture
          onCapture={(file, url) => {
            if (preview) URL.revokeObjectURL(preview);
            setPhoto(file);
            setPreview(url);
            setScanResult(null);
            setMessage("");
            setShowCamera(false);
            setInputMode("upload"); // show preview in upload panel
          }}
          onClose={() => setShowCamera(false)}
        />
      )}

      {/* Top grid: upload + metadata */}
      <div className="scanner-grid">
        {/* Upload panel */}
        <div className="panel scanner-upload">
          <div className="panel-heading">
            <div><h3>Road Image Input</h3><p>Upload a file or capture with camera</p></div>
            <span className="demo-tag">AI INPUT</span>
          </div>

          {/* Input mode switcher */}
          <div className="input-mode-row">
            <button
              className={`input-mode-btn ${inputMode === "upload" ? "active" : ""}`}
              onClick={() => setInputMode("upload")}
            >
              ↑ Upload Image
            </button>
            <button
              className={`input-mode-btn ${inputMode === "camera" ? "active" : ""}`}
              onClick={() => { setInputMode("camera"); setShowCamera(true); }}
            >
              ◎ Open Camera
            </button>
          </div>

          {!preview ? (
            <label className="scanner-dropzone">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePhoto} />
              <span className="upload-icon">↑</span>
              <strong>Choose or drag a road photo</strong>
              <small>JPG · PNG · WEBP · Max 10 MB</small>
            </label>
          ) : (
            <div className="scanner-preview">
              <img src={preview} alt="Road for scanning" />
              <div className="preview-details">
                <span>{photo?.name}</span>
                <button type="button" onClick={removePhoto} disabled={loading}>✕ Remove</button>
              </div>
            </div>
          )}

          {/* Optional metadata */}
          <div className="meta-row">
            <div className="meta-field">
              <label>Latitude</label>
              <input type="number" placeholder="18.5204" value={lat} onChange={e => setLat(e.target.value)} />
            </div>
            <div className="meta-field">
              <label>Longitude</label>
              <input type="number" placeholder="73.8567" value={lng} onChange={e => setLng(e.target.value)} />
            </div>
            <button className="gps-btn" type="button" onClick={getGPS} disabled={gpsLoading}>
              {gpsLoading ? "…" : "⌖ GPS"}
            </button>
          </div>
          <div className="meta-field" style={{ marginTop: 8 }}>
            <label>Location Label (optional)</label>
            <input type="text" placeholder="e.g. Pune–Nagar Road, Km 14" value={locationLabel} onChange={e => setLocationLabel(e.target.value)} />
          </div>

          <button className="primary-btn scanner-analyze" onClick={analyzeRoad} disabled={!photo || loading}>
            {loading ? "◌ Analyzing Road…" : "◎ Analyze Road Damage"}
          </button>
          {message && <p className="scanner-message">{message}</p>}
        </div>

        {/* Info + model panel */}
        <div className="panel scanner-info">
          <div className="panel-heading">
            <div><h3>Detection Pipeline</h3><p>7-class YOLO road damage model</p></div>
          </div>
          {[
            ["01", "Image Upload", "Select a road surface photo."],
            ["02", "YOLO Inference", "Trained model detects 7 damage classes."],
            ["03", "Health Scoring", "Rule-based road health score (0–100)."],
            ["04", "Cause Analysis", "Infer likely damage causes from detections."],
            ["05", "Repair Priority", "P1–P4 urgency based on severity mix."],
          ].map(([n, t, d]) => (
            <div className="scanner-info-item" key={n}>
              <span>{n}</span>
              <div><strong>{t}</strong><small>{d}</small></div>
            </div>
          ))}
          <div className="scanner-note">
            <strong>Detectable Classes</strong>
            <p>{Object.values(DAMAGE_LABELS).join(" · ")}</p>
          </div>
          <div className="scanner-note" style={{ marginTop: 10 }}>
            <strong>Data Labels</strong>
            <p>Health Score: Rule-Based Estimate · Detections: AI Detected · Causes: Rule-Based Inference</p>
          </div>
        </div>
      </div>

      {/* Results section */}
      {scanResult && (
        <div className="panel scanner-results">
          <div className="panel-heading">
            <div><h3>AI Analysis Report</h3><p>Generated by RoadSentinel YOLO model</p></div>
            <span className="live-tag">● LIVE AI RESULT</span>
          </div>

          {/* Summary cards */}
          <div className="result-summary-grid">
            <div className="result-card">
              <small>Detections</small>
              <strong>{scanResult.count}</strong>
              <span>damage instances</span>
            </div>
            <div className="result-card" style={{ borderColor: SEVERITY_COLOR[scanResult.severity] || "#52adff" }}>
              <small>Overall Severity</small>
              <strong style={{ color: SEVERITY_COLOR[scanResult.severity] || "#52adff" }}>{scanResult.severity}</strong>
              <span>AI Detected</span>
            </div>
            <div className="result-card" style={{ borderColor: riskCat.color }}>
              <small>Risk Category</small>
              <strong style={{ color: riskCat.color }}>{riskCat.label}</strong>
              <span>Rule-Based Estimate</span>
            </div>
            <div className="result-card">
              <small>Repair Priority</small>
              <strong style={{ color: priority.urgency === "URGENT" ? "#ff5c6a" : priority.urgency === "HIGH" ? "#ff8c42" : priority.urgency === "MEDIUM" ? "#ffb347" : "#42d69a" }}>
                {priority.level}
              </strong>
              <span>Rule-Based Estimate</span>
            </div>
          </div>

          {/* Tabs */}
          <div className="result-tabs">
            {["results", "health", "causes", "priority"].map(t => (
              <button key={t} className={`result-tab ${activeTab === t ? "active" : ""}`} onClick={() => setActiveTab(t)}>
                {t === "results" ? "◎ Detections" : t === "health" ? "♥ Health Score" : t === "causes" ? "⚑ Cause Analysis" : "⚙ Repair Priority"}
              </button>
            ))}
          </div>

          {/* Tab: Detections */}
          {activeTab === "results" && (
            <div className="tab-content">
              <div className="detection-layout">
                <div>
                  {scanResult.annotatedImage && (
                    <div className="annotated-wrap">
                      <p className="tab-label">AI Annotated Image · AI Detected</p>
                      <img src={`${API_BASE}${scanResult.annotatedImage}`} alt="Annotated road" />
                    </div>
                  )}
                </div>
                <div>
                  <p className="tab-label">Severity Breakdown · AI Detected</p>
                  <SeverityBar label="High" count={highCount} total={scanResult.count} color="#ff5c6a" />
                  <SeverityBar label="Medium" count={medCount} total={scanResult.count} color="#ffb347" />
                  <SeverityBar label="Low" count={lowCount} total={scanResult.count} color="#42d69a" />

                  <p className="tab-label" style={{ marginTop: 20 }}>Detected Damage Items</p>
                  {scanResult.count === 0 ? (
                    <div className="no-damage">✓ No damage detected in this image.</div>
                  ) : (
                    scanResult.detections.map((item, i) => (
                      <div className="det-item" key={i} style={{ borderLeft: `3px solid ${SEVERITY_COLOR[item.severity]}` }}>
                        <div className="det-item-top">
                          <strong>{DAMAGE_LABELS[item.damage] || item.damage}</strong>
                          <span className="det-sev" style={{ color: SEVERITY_COLOR[item.severity], background: SEVERITY_COLOR[item.severity] + "22" }}>
                            {item.severity}
                          </span>
                        </div>
                        <small>{DAMAGE_DESC[item.damage] || ""}</small>
                        <div className="det-meta">
                          <span>Confidence: <b>{item.confidence}%</b></span>
                          <span>Box: {item.box.map(v => Math.round(v)).join(", ")}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Tab: Health Score */}
          {activeTab === "health" && (
            <div className="tab-content">
              <p className="tab-label">Road Health Score · Rule-Based Estimate</p>
              <div className="health-layout">
                <HealthGauge score={healthScore} />
                <div className="health-breakdown">
                  <div className="health-row">
                    <span>Base Score</span><span>100 / 100</span>
                  </div>
                  {scanResult.detections.map((d, i) => (
                    <div className="health-row deduct" key={i}>
                      <span>− {DAMAGE_LABELS[d.damage] || d.damage} ({d.severity})</span>
                      <span style={{ color: SEVERITY_COLOR[d.severity] }}>
                        −{d.severity === "High" ? 18 : d.severity === "Medium" ? 9 : 4}
                      </span>
                    </div>
                  ))}
                  <div className="health-row total" style={{ borderTop: "1px solid #2a3a50", marginTop: 8, paddingTop: 8 }}>
                    <span>Final Health Score</span>
                    <span style={{ color: riskCat.color, fontWeight: 700 }}>{healthScore} / 100</span>
                  </div>
                  <div className="health-badge" style={{ background: riskCat.bg, color: riskCat.color, borderColor: riskCat.color }}>
                    {riskCat.label}
                  </div>
                  <p className="disclaimer-small">Rule-Based Estimate. Not a certified structural assessment.</p>
                </div>
              </div>
            </div>
          )}

          {/* Tab: Cause Analysis */}
          {activeTab === "causes" && (
            <div className="tab-content">
              <p className="tab-label">Probable Damage Causes · Rule-Based Inference</p>
              {causes.length === 0 ? (
                <div className="no-damage">✓ No damage detected — no causes to infer.</div>
              ) : (
                <div className="causes-list">
                  {causes.map((c, i) => (
                    <div className="cause-item" key={i}>
                      <span className="cause-num">{i + 1}</span>
                      <span>{c}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="tab-label" style={{ marginTop: 24 }}>Damage Type Mapping · AI Detected</p>
              <div className="damage-map">
                {scanResult.detections.map((d, i) => (
                  <div className="damage-map-row" key={i}>
                    <span className="dm-type" style={{ borderColor: SEVERITY_COLOR[d.severity] }}>
                      {DAMAGE_LABELS[d.damage] || d.damage}
                    </span>
                    <span className="dm-arrow">→</span>
                    <span className="dm-desc">{DAMAGE_DESC[d.damage]}</span>
                  </div>
                ))}
              </div>
              <p className="disclaimer-small" style={{ marginTop: 16 }}>Causes are rule-based inferences from detected damage types. Field verification recommended.</p>
            </div>
          )}

          {/* Tab: Repair Priority */}
          {activeTab === "priority" && (
            <div className="tab-content">
              <p className="tab-label">Repair Priority Assessment · Rule-Based Estimate</p>
              <div className="priority-card" style={{
                borderColor: priority.urgency === "URGENT" ? "#ff5c6a" : priority.urgency === "HIGH" ? "#ff8c42" : priority.urgency === "MEDIUM" ? "#ffb347" : "#42d69a",
                background: priority.urgency === "URGENT" ? "#2a0d12" : priority.urgency === "HIGH" ? "#2a1508" : priority.urgency === "MEDIUM" ? "#2a1e0a" : "#0d2a1e",
              }}>
                <div className="priority-level" style={{ color: priority.urgency === "URGENT" ? "#ff5c6a" : priority.urgency === "HIGH" ? "#ff8c42" : priority.urgency === "MEDIUM" ? "#ffb347" : "#42d69a" }}>
                  {priority.level}
                </div>
                <p>{priority.action}</p>
              </div>

              <p className="tab-label" style={{ marginTop: 20 }}>Priority Logic</p>
              <div className="priority-rules">
                {[
                  ["P1 — Immediate", "≥3 High severity OR alligator crack detected", highCount >= 3 || scanResult.detections.some(d => d.damage === "alligator_crack")],
                  ["P2 — High", "Any High severity damage", highCount > 0 && !(highCount >= 3 || scanResult.detections.some(d => d.damage === "alligator_crack"))],
                  ["P3 — Medium", "Medium severity, no High", medCount > 0 && highCount === 0],
                  ["P4 — Low", "Low severity only", lowCount > 0 && medCount === 0 && highCount === 0],
                ].map(([lvl, rule, matched]) => (
                  <div className={`priority-rule-row ${matched ? "matched" : ""}`} key={lvl}>
                    <span>{matched ? "✓" : "○"}</span>
                    <div><strong>{lvl}</strong><small>{rule}</small></div>
                  </div>
                ))}
              </div>
              <p className="disclaimer-small" style={{ marginTop: 16 }}>Rule-Based Estimate. Actual repair scheduling requires field inspection and budget assessment.</p>
            </div>
          )}
        </div>
      )}

      {/* Scan History */}
      <div className="panel" style={{ marginTop: 24 }}>
        <div className="panel-heading">
          <div><h3>Recent AI Scans</h3><p>From database · AI Detected</p></div>
          <span className="demo-tag">{history.length} RECORDS</span>
        </div>
        {historyLoading ? (
          <p style={{ color: "#8494aa", fontSize: 12, padding: "12px 0" }}>Loading scan history…</p>
        ) : history.length === 0 ? (
          <p style={{ color: "#8494aa", fontSize: 12, padding: "12px 0" }}>No scans yet. Run your first analysis above.</p>
        ) : (
          <div className="history-grid">
            {history.map(h => (
              <div className="history-item" key={h.id}>
                <div className="history-top">
                  <span className="history-type">{DAMAGE_LABELS[h.damageType] || h.damageType}</span>
                  <span className="det-sev" style={{ color: SEVERITY_COLOR[h.severity], background: SEVERITY_COLOR[h.severity] + "22", fontSize: 9, padding: "2px 7px", borderRadius: 4 }}>
                    {h.severity}
                  </span>
                </div>
                <small>Confidence: {h.confidence?.toFixed(1)}%</small>
                <small>{h.hasGPS ? `⌖ ${h.latitude?.toFixed(4)}, ${h.longitude?.toFixed(4)}` : "No GPS"}</small>
                <small style={{ color: "#5a6a7a" }}>{h.scannedAt?.slice(0, 10)}</small>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
