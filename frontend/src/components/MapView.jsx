import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleMarker, LayersControl, MapContainer,
  Popup, Rectangle, TileLayer, ZoomControl,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./MapView.css";

const API_BASE = "http://127.0.0.1:5001";
const REFRESH_MS = 30000;

const RISK_COLORS = {
  CRITICAL: "#ff3d4a",
  HIGH: "#ff9f43",
  MEDIUM: "#f4d35e",
  LOW: "#27c98b",
};

const DAMAGE_LABELS = {
  pothole: "Pothole",
  longitudinal_crack: "Longitudinal Crack",
  transverse_crack: "Transverse Crack",
  alligator_crack: "Alligator Crack",
  waterlogging: "Waterlogging",
  repaired_patch: "Repaired Patch",
  road_edge_damage: "Road Edge Damage",
};

const TILE_LAYERS = {
  street: {
    label: "Street",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  },
  satellite: {
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics",
    maxZoom: 19,
  },
  hybrid: {
    label: "Hybrid",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
    maxZoom: 19,
    overlay: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  },
};

function fmt(iso) {
  if (!iso) return "Unknown";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function RiskBadge({ level }) {
  return (
    <span className="rm-badge" style={{ color: RISK_COLORS[level], borderColor: RISK_COLORS[level] }}>
      {level}
    </span>
  );
}

function ScoreBar({ score, level }) {
  return (
    <div className="rm-score-track">
      <div className="rm-score-fill" style={{ width: `${score}%`, background: RISK_COLORS[level] }} />
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="rm-row">
      <span>{label}</span>
      <strong>{value ?? "Unknown"}</strong>
    </div>
  );
}

function PhotoViewer({ src, label, isB64 }) {
  const [open, setOpen] = useState(false);
  if (!src) return null;
  const imgSrc = isB64 ? `data:image/jpeg;base64,${src}` : `${API_BASE}${src}`;
  return (
    <>
      <div className="rm-photo-slot">
        {label && <p className="rm-photo-label">{label}</p>}
        <img className="rm-thumb" src={imgSrc} alt={label} onClick={() => setOpen(true)} />
      </div>
      {open && (
        <div className="rm-lightbox" onClick={() => setOpen(false)}>
          <img src={imgSrc} alt={label} />
          <button className="rm-lb-close">✕</button>
        </div>
      )}
    </>
  );
}

function MarkerDetail({ marker, onClose }) {
  if (!marker) {
    return (
      <div className="rm-detail-empty">
        <span>⌖</span>
        <p>Click a map marker to view full damage details.</p>
      </div>
    );
  }

  const isAI = marker.source === "ai";
  const isSat = marker.source === "satellite";
  const label = isSat
    ? (marker.locationLabel || "Satellite Area")
    : isAI
      ? (DAMAGE_LABELS[marker.damageType] || marker.damageType)
      : marker.reportType;

  const gmapsUrl = marker.latitude && marker.longitude
    ? `https://www.google.com/maps?q=${marker.latitude},${marker.longitude}`
    : null;

  return (
    <div className="rm-detail-content">
      <div className="rm-detail-hd">
        <div>
          <span className="rm-eyebrow">
            {isSat ? "SATELLITE ANALYSIS" : isAI ? "AI DETECTION" : "CITIZEN REPORT"}
          </span>
          <h3>{label}</h3>
        </div>
        <button className="rm-close-btn" onClick={onClose}>✕</button>
      </div>

      <RiskBadge level={marker.riskLevel} />

      <div className="rm-score-row">
        <span>Risk Score</span>
        <strong style={{ color: RISK_COLORS[marker.riskLevel] }}>{marker.riskScore}/100</strong>
      </div>
      <ScoreBar score={marker.riskScore} level={marker.riskLevel} />

      <div className="rm-rows">
        {isSat && (
          <>
            <Row label="Data Source" value="Sentinel-2 L2A (ESA Copernicus)" />
            <Row label="Resolution" value={marker.resolutionM ? `${marker.resolutionM}m` : "60m"} />
            <Row label="Scene Date" value={marker.sceneDate || "Unknown"} />
            <Row label="Waterlogging" value={marker.waterloggingPct != null ? `${marker.waterloggingPct}%` : "Unknown"} />
            <Row label="Dark Surface" value={marker.darkSurfacePct != null ? `${marker.darkSurfacePct}%` : "Unknown"} />
            <Row label="NDWI Mean" value={marker.ndwiMean != null ? marker.ndwiMean.toFixed(4) : "Unknown"} />
            <Row label="Analyzed At" value={fmt(marker.analyzedAt)} />
          </>
        )}
        {isAI && (
          <>
            <Row label="Damage Type" value={label} />
            <Row label="Severity" value={marker.severity} />
            <Row label="AI Confidence" value={marker.confidence ? `${marker.confidence}%` : "Unknown"} />
            <Row label="GPS" value={marker.latitude ? `${marker.latitude.toFixed(5)}, ${marker.longitude.toFixed(5)}` : "Not available"} />
            <Row label="Location" value={marker.locationLabel || "Unknown"} />
            <Row label="Scanned At" value={fmt(marker.scannedAt)} />
          </>
        )}
        {!isAI && !isSat && (
          <>
            <Row label="Report Type" value={marker.reportType} />
            <Row label="Severity" value={marker.severity} />
            <Row label="GPS" value={marker.latitude ? `${marker.latitude.toFixed(5)}, ${marker.longitude.toFixed(5)}` : "Not available"} />
            <Row label="Location" value={marker.location} />
            <Row label="Status" value={marker.status} />
            {marker.description && <Row label="Description" value={marker.description} />}
            <Row label="Reported At" value={fmt(marker.createdAt)} />
          </>
        )}
        <Row label="Source" value={isSat ? "Satellite (Sentinel-2)" : isAI ? "YOLO AI Scanner" : "Citizen Portal"} />
      </div>

      {isSat && marker.findings && marker.findings.length > 0 && (
        <div className="rm-findings">
          <p className="rm-findings-title">Satellite Findings</p>
          {marker.findings.map((f, i) => (
            <div key={i} className="rm-finding-row">
              <strong>{f.label}</strong>
              {f.coverage_pct != null && <span>{f.coverage_pct}% coverage</span>}
              {f.value != null && <span>Value: {f.value}</span>}
              <em>Confidence: {f.confidence}</em>
              <small>{f.note}</small>
            </div>
          ))}
          <div className="rm-sat-limit">
            <strong>Resolution Limitation</strong>
            <p>Sentinel-2 at 60m cannot detect individual potholes or cracks. Use YOLO ground-level scanner for those.</p>
          </div>
        </div>
      )}

      {isSat && (
        <div className="rm-photo-pair">
          <PhotoViewer src={marker.imageRgbB64} label="True Colour (RGB)" isB64 />
          <PhotoViewer src={marker.imageNdwiB64} label="NDWI Water Index" isB64 />
        </div>
      )}

      {isAI && (
        <div className="rm-photo-pair">
          <PhotoViewer src={marker.originalImage} label="Original" />
          <PhotoViewer src={marker.annotatedImage} label="AI Annotated" />
        </div>
      )}

      {!isAI && !isSat && marker.photo && (
        <div className="rm-photo-pair">
          <PhotoViewer src={marker.photo} label="Reported Photo" />
        </div>
      )}

      <div className="rm-risk-basis">
        <strong>Risk Score Basis</strong>
        <p>
          {isSat
            ? `Score from satellite spectral analysis: waterlogging ${marker.waterloggingPct ?? "N/A"}%, dark surface ${marker.darkSurfacePct ?? "N/A"}%.`
            : isAI
              ? `Score from damage type (${marker.severity} severity) × AI confidence (${marker.confidence ?? "N/A"}%).`
              : `Score from reported damage type (${marker.severity} severity) and citizen data.`}
        </p>
      </div>

      {gmapsUrl && (
        <a className="rm-gmaps-btn" href={gmapsUrl} target="_blank" rel="noopener noreferrer">
          ⌖ Open in Google Maps
        </a>
      )}
    </div>
  );
}

function SatellitePanel({ satStatus, onAnalyze, analyzing, analysisError }) {
  const [west, setWest] = useState("73.97");
  const [south, setSouth] = useState("18.45");
  const [east, setEast] = useState("74.07");
  const [north, setNorth] = useState("18.55");
  const [label, setLabel] = useState("");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  function submit(e) {
    e.preventDefault();
    onAnalyze({ west: parseFloat(west), south: parseFloat(south), east: parseFloat(east), north: parseFloat(north), startDate, endDate, locationLabel: label });
  }

  if (!satStatus) return null;

  return (
    <div className="rm-sat-panel">
      <div className="rm-sat-panel-hd">
        <div>
          <span className="rm-eyebrow">SENTINEL-2 ANALYSIS</span>
          <h4>Satellite Road Area Scan</h4>
        </div>
        <span className={`rm-sat-status-dot ${satStatus.configured ? "connected" : "disconnected"}`}>
          {satStatus.configured ? "● Connected" : "● Not Connected"}
        </span>
      </div>

      {!satStatus.configured ? (
        <div className="rm-sat-unconfigured">
          <p>Sentinel Hub credentials not configured.</p>
          <ol>
            <li>Register free at <a href="https://www.sentinel-hub.com/" target="_blank" rel="noopener noreferrer">sentinel-hub.com</a></li>
            <li>Create an OAuth client in your dashboard</li>
            <li>Add <code>SH_CLIENT_ID</code> and <code>SH_CLIENT_SECRET</code> to <code>backend/.env</code></li>
            <li>Restart the backend server</li>
          </ol>
          <div className="rm-sat-limit">
            <strong>What Sentinel-2 can detect at 10–60m resolution:</strong>
            <p>Large-scale waterlogging, surface flooding, vegetation loss, major surface changes. It <em>cannot</em> detect individual potholes or cracks — use the YOLO AI Scanner for those.</p>
          </div>
        </div>
      ) : (
        <form className="rm-sat-form" onSubmit={submit}>
          <div className="rm-sat-form-row">
            <label>West<input type="number" step="0.001" value={west} onChange={e => setWest(e.target.value)} /></label>
            <label>South<input type="number" step="0.001" value={south} onChange={e => setSouth(e.target.value)} /></label>
            <label>East<input type="number" step="0.001" value={east} onChange={e => setEast(e.target.value)} /></label>
            <label>North<input type="number" step="0.001" value={north} onChange={e => setNorth(e.target.value)} /></label>
          </div>
          <div className="rm-sat-form-row">
            <label>Start Date<input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></label>
            <label>End Date<input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></label>
            <label>Location Label<input type="text" placeholder="e.g. Pune Ring Road" value={label} onChange={e => setLabel(e.target.value)} /></label>
          </div>
          {analysisError && <p className="rm-sat-error">{analysisError}</p>}
          <button type="submit" className="rm-sat-submit" disabled={analyzing}>
            {analyzing ? "Fetching Sentinel-2 imagery…" : "Run Satellite Analysis"}
          </button>
          <p className="rm-sat-note">
            Uses Sentinel-2 L2A at 60m resolution. Free tier: ~300 requests/month.
            Max cloud cover: 40%. Results saved to database.
          </p>
        </form>
      )}
    </div>
  );
}

export default function MapView() {
  const [data, setData] = useState(null);
  const [satStatus, setSatStatus] = useState(null);
  const [satHistory, setSatHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [selected, setSelected] = useState(null);
  const [activeTab, setActiveTab] = useState("map"); // map | satellite | analytics
  const [tileLayer, setTileLayer] = useState("satellite");
  const [filterRisk, setFilterRisk] = useState("ALL");
  const [filterSource, setFilterSource] = useState("ALL");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  const intervalRef = useRef(null);

  const fetchAll = useCallback(async () => {
    try {
      const [mapRes, satRes, histRes] = await Promise.all([
        fetch(`${API_BASE}/api/map/data`),
        fetch(`${API_BASE}/api/satellite/status`),
        fetch(`${API_BASE}/api/satellite/history`),
      ]);
      const [mapJson, satJson, histJson] = await Promise.all([
        mapRes.json(), satRes.json(), histRes.json(),
      ]);
      if (!mapJson.success) throw new Error(mapJson.message || "Map API error");
      setData(mapJson);
      setSatStatus(satJson);
      setSatHistory(histJson.analyses || []);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    intervalRef.current = setInterval(fetchAll, REFRESH_MS);
    return () => clearInterval(intervalRef.current);
  }, [fetchAll]);

  async function runSatelliteAnalysis(params) {
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const res = await fetch(`${API_BASE}/api/satellite/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Analysis failed");
      await fetchAll();
      setActiveTab("map");
    } catch (err) {
      setAnalysisError(err.message);
    } finally {
      setAnalyzing(false);
    }
  }

  // Build all markers including satellite analyses
  const allMarkers = useMemo(() => {
    if (!data) return [];
    const satMarkers = satHistory.map(a => ({
      id: `sat_${a.id}`,
      source: "satellite",
      locationLabel: a.locationLabel,
      latitude: a.centerLat,
      longitude: a.centerLng,
      hasGPS: true,
      riskLevel: a.riskLevel || "LOW",
      riskScore: a.riskScore || 10,
      sceneDate: a.sceneDate,
      resolutionM: a.resolutionM,
      waterloggingPct: a.waterloggingPct,
      darkSurfacePct: a.darkSurfacePct,
      ndwiMean: a.ndwiMean,
      findings: a.findings,
      analyzedAt: a.analyzedAt,
      bbox: a.bbox,
    }));
    return [...data.citizenReports, ...data.aiDetections, ...satMarkers];
  }, [data, satHistory]);

  const mappable = useMemo(() => allMarkers.filter(m => m.hasGPS), [allMarkers]);

  const filtered = useMemo(() => mappable.filter(m => {
    if (filterRisk !== "ALL" && m.riskLevel !== filterRisk) return false;
    if (filterSource === "AI" && m.source !== "ai") return false;
    if (filterSource === "CITIZEN" && m.source !== "citizen") return false;
    if (filterSource === "SATELLITE" && m.source !== "satellite") return false;
    return true;
  }), [mappable, filterRisk, filterSource]);

  const mapCenter = useMemo(() => {
    if (mappable.length === 0) return [19.5, 75.5];
    const lats = mappable.map(m => m.latitude);
    const lngs = mappable.map(m => m.longitude);
    return [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2];
  }, [mappable]);

  const stats = data?.stats ?? {};

  const recent = useMemo(() => [...allMarkers]
    .sort((a, b) => new Date(b.createdAt || b.scannedAt || b.analyzedAt || 0) - new Date(a.createdAt || a.scannedAt || a.analyzedAt || 0))
    .slice(0, 6), [allMarkers]);

  if (loading) return (
    <div className="rm-state"><div className="rm-spinner" /><p>Connecting to RoadSentinel database…</p></div>
  );
  if (error) return (
    <div className="rm-state rm-state-err">
      <span>⚠</span><h3>Backend Unavailable</h3><p>{error}</p>
      <button className="rm-refresh-btn" onClick={fetchAll}>Retry</button>
    </div>
  );

  const tile = TILE_LAYERS[tileLayer];

  return (
    <div className="rm-root">

      {/* Header */}
      <div className="rm-header">
        <div>
          <span className="rm-eyebrow">SATELLITE + AI ROAD INTELLIGENCE</span>
          <h2>Live Risk Map</h2>
          <p>Real Sentinel-2 satellite imagery, YOLO AI detections and citizen reports.</p>
        </div>
        <div className="rm-header-right">
          <div className="rm-live-pill"><span className="rm-live-dot" />LIVE DATA</div>
          <button className="rm-refresh-btn" onClick={fetchAll}>↻ Refresh</button>
        </div>
      </div>

      {/* Stats */}
      <div className="rm-stats-grid">
        {[
          ["Citizen Reports", stats.totalReports ?? 0, "Verified submissions", ""],
          ["AI Detections", stats.totalAIDetections ?? 0, "YOLO scan results", ""],
          ["Satellite Scans", satHistory.length, "Sentinel-2 analyses", ""],
          ["Critical Risk", stats.criticalLocations ?? 0, "Immediate attention", "critical"],
          ["High Risk", stats.highRiskLocations ?? 0, "Needs inspection", "high"],
          ["Pending", stats.pendingReports ?? 0, "Awaiting action", ""],
        ].map(([title, val, sub, cls]) => (
          <div key={title} className={`rm-stat ${cls}`}>
            <span>{title}</span>
            <strong>{val}</strong>
            <small>{sub}</small>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="rm-tabs">
        {[["map", "⌖ Map"], ["satellite", "◈ Satellite Analysis"], ["analytics", "▥ Analytics"]].map(([id, lbl]) => (
          <button key={id} className={`rm-tab ${activeTab === id ? "active" : ""}`} onClick={() => setActiveTab(id)}>{lbl}</button>
        ))}
        {lastUpdated && <span className="rm-tab-updated">Updated {lastUpdated.toLocaleTimeString("en-IN")}</span>}
      </div>

      {/* ── MAP TAB ── */}
      {activeTab === "map" && (
        <>
          {/* Toolbar */}
          <div className="rm-toolbar">
            <div className="rm-toolbar-group">
              <label>Map Layer</label>
              <div className="rm-filter-row">
                {Object.entries(TILE_LAYERS).map(([key, t]) => (
                  <button key={key} className={`rm-filter-btn ${tileLayer === key ? "active" : ""}`} onClick={() => setTileLayer(key)}>{t.label}</button>
                ))}
              </div>
            </div>
            <div className="rm-toolbar-group">
              <label>Risk Level</label>
              <div className="rm-filter-row">
                {["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"].map(r => (
                  <button key={r} className={`rm-filter-btn ${filterRisk === r ? "active" : ""}`}
                    style={filterRisk === r && r !== "ALL" ? { borderColor: RISK_COLORS[r], color: RISK_COLORS[r] } : {}}
                    onClick={() => setFilterRisk(r)}>{r}</button>
                ))}
              </div>
            </div>
            <div className="rm-toolbar-group">
              <label>Source</label>
              <div className="rm-filter-row">
                {[["ALL", "All"], ["AI", "AI Scanner"], ["CITIZEN", "Citizen"], ["SATELLITE", "Satellite"]].map(([v, lbl]) => (
                  <button key={v} className={`rm-filter-btn ${filterSource === v ? "active" : ""}`} onClick={() => setFilterSource(v)}>{lbl}</button>
                ))}
              </div>
            </div>
            <div className="rm-toolbar-count">
              <strong>{filtered.length}</strong>
              <small>markers</small>
            </div>
          </div>

          {/* Map + Detail */}
          <div className="rm-map-layout">
            <div className="rm-map-wrap">
              {mappable.length === 0 ? (
                <div className="rm-map-empty">
                  <span>⌖</span>
                  <h3>No GPS Data Yet</h3>
                  <p>Submit a citizen report with GPS, run an AI scan with location, or run a satellite analysis to see markers.</p>
                </div>
              ) : (
                <MapContainer key={`${mapCenter[0]},${mapCenter[1]},${tileLayer}`}
                  center={mapCenter} zoom={mappable.length === 1 ? 14 : 10}
                  minZoom={4} maxZoom={19} scrollWheelZoom zoomControl={false} className="rm-leaflet">
                  <TileLayer url={tile.url} attribution={tile.attribution} maxZoom={tile.maxZoom} />
                  {tileLayer === "hybrid" && (
                    <TileLayer url={tile.overlay} opacity={0.4} />
                  )}
                  <ZoomControl position="topright" />

                  {filtered.map(m => {
                    const isSat = m.source === "satellite";
                    const color = RISK_COLORS[m.riskLevel];
                    const isSelected = selected?.id === m.id;
                    return (
                      <CircleMarker key={m.id}
                        center={[m.latitude, m.longitude]}
                        radius={isSat ? (isSelected ? 18 : 14) : (isSelected ? 13 : 9)}
                        pathOptions={{
                          color, fillColor: color, fillOpacity: isSat ? 0.25 : 0.88,
                          weight: isSelected ? 4 : isSat ? 2 : 2,
                          dashArray: isSat ? "6 3" : undefined,
                        }}
                        eventHandlers={{ click: () => setSelected(m) }}>
                        <Popup>
                          <div className="rm-popup">
                            <strong>{isSat ? (m.locationLabel || "Satellite Area") : m.source === "ai" ? (DAMAGE_LABELS[m.damageType] || m.damageType) : m.reportType}</strong>
                            <span style={{ color }}>{m.riskLevel} · {m.riskScore}/100</span>
                            <small>{m.latitude.toFixed(5)}, {m.longitude.toFixed(5)}</small>
                            <small>{isSat ? "Sentinel-2" : m.source === "ai" ? "YOLO AI" : "Citizen"}</small>
                          </div>
                        </Popup>
                      </CircleMarker>
                    );
                  })}

                  {/* Satellite bbox rectangles */}
                  {filtered.filter(m => m.source === "satellite" && m.bbox).map(m => (
                    <Rectangle key={`bbox_${m.id}`}
                      bounds={[[m.bbox.south, m.bbox.west], [m.bbox.north, m.bbox.east]]}
                      pathOptions={{ color: RISK_COLORS[m.riskLevel], fillOpacity: 0.08, weight: 1, dashArray: "4 4" }} />
                  ))}
                </MapContainer>
              )}

              <div className="rm-legend">
                {Object.entries(RISK_COLORS).map(([lvl, col]) => (
                  <span key={lvl}><i style={{ background: col }} />{lvl}</span>
                ))}
                <span className="rm-legend-sep">|</span>
                <span><i className="rm-legend-solid" style={{ background: "#63a9ed" }} />AI/Citizen</span>
                <span><i className="rm-legend-dashed" />Satellite</span>
              </div>

              <div className="rm-tile-credit">
                {tileLayer !== "street"
                  ? "Imagery © Esri, Maxar, Earthstar Geographics"
                  : "Map © OpenStreetMap contributors"}
              </div>
            </div>

            <aside className="rm-detail-panel">
              <div className="rm-detail-panel-hd">
                <span className="rm-eyebrow">LOCATION DETAILS</span>
              </div>
              <MarkerDetail marker={selected} onClose={() => setSelected(null)} />
            </aside>
          </div>
        </>
      )}

      {/* ── SATELLITE TAB ── */}
      {activeTab === "satellite" && (
        <div className="rm-sat-tab">
          <SatellitePanel satStatus={satStatus} onAnalyze={runSatelliteAnalysis} analyzing={analyzing} analysisError={analysisError} />

          {satHistory.length > 0 && (
            <div className="rm-sat-history">
              <div className="rm-analytics-hd">
                <h4>Past Satellite Analyses</h4>
                <small>{satHistory.length} records from database</small>
              </div>
              {satHistory.map(a => (
                <div key={a.id} className="rm-sat-hist-row" onClick={() => {
                  const m = allMarkers.find(x => x.id === `sat_${a.id}`);
                  if (m) { setSelected(m); setActiveTab("map"); }
                }}>
                  <div className="rm-sat-hist-info">
                    <strong>{a.locationLabel || "Unnamed Area"}</strong>
                    <small>Scene: {a.sceneDate || "Unknown"} · {a.resolutionM || 60}m res · {fmt(a.analyzedAt)}</small>
                    <small>Waterlogging: {a.waterloggingPct ?? "N/A"}% · Dark surface: {a.darkSurfacePct ?? "N/A"}%</small>
                  </div>
                  <RiskBadge level={a.riskLevel || "LOW"} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ANALYTICS TAB ── */}
      {activeTab === "analytics" && (
        <div className="rm-analytics-grid">
          <div className="rm-analytics-card">
            <div className="rm-analytics-hd"><h4>Damage Breakdown</h4><small>All sources</small></div>
            {Object.keys(stats.damageBreakdown ?? {}).length === 0
              ? <p className="rm-no-data">No damage data yet.</p>
              : Object.entries(stats.damageBreakdown).map(([type, count]) => {
                  const max = Math.max(...Object.values(stats.damageBreakdown));
                  return (
                    <div key={type} className="rm-breakdown-row">
                      <span>{DAMAGE_LABELS[type] || type}</span>
                      <div className="rm-breakdown-track"><div className="rm-breakdown-fill" style={{ width: `${(count / max) * 100}%` }} /></div>
                      <strong>{count}</strong>
                    </div>
                  );
                })}
          </div>

          <div className="rm-analytics-card">
            <div className="rm-analytics-hd"><h4>Recent Activity</h4><small>Latest 6 records</small></div>
            {recent.length === 0
              ? <p className="rm-no-data">No records yet.</p>
              : recent.map(item => {
                  const isSat = item.source === "satellite";
                  const isAI = item.source === "ai";
                  const lbl = isSat ? (item.locationLabel || "Satellite Area") : isAI ? (DAMAGE_LABELS[item.damageType] || item.damageType) : item.reportType;
                  const ts = item.createdAt || item.scannedAt || item.analyzedAt;
                  return (
                    <div key={item.id} className="rm-recent-row" onClick={() => item.hasGPS && setSelected(item)} style={{ cursor: item.hasGPS ? "pointer" : "default" }}>
                      <div className="rm-recent-dot" style={{ background: RISK_COLORS[item.riskLevel] }} />
                      <div className="rm-recent-info">
                        <strong>{lbl}</strong>
                        <small>{isSat ? "Satellite" : isAI ? "AI Scanner" : "Citizen"} · {fmt(ts)}</small>
                      </div>
                      <RiskBadge level={item.riskLevel} />
                    </div>
                  );
                })}
          </div>

          <div className="rm-analytics-card rm-integrity-card">
            <div className="rm-analytics-hd"><h4>Data Integrity</h4><small>Source transparency</small></div>
            {[
              ["green", "Citizen reports from SQLite database"],
              ["blue", "AI detections from YOLO scanner"],
              ["purple", "Satellite data from Sentinel-2 L2A (ESA)"],
              ["yellow", "GPS shown only when user-provided"],
              ["red", "No fake coordinates or demo data"],
            ].map(([cls, txt]) => (
              <div key={txt} className="rm-integrity-row">
                <span className={`rm-integrity-dot ${cls}`} />
                <span>{txt}</span>
              </div>
            ))}
            <div className="rm-integrity-row">
              <span className="rm-integrity-dot grey" />
              <span>Sentinel Hub: <em className={satStatus?.configured ? "rm-connected" : "rm-not-connected"}>{satStatus?.configured ? "Connected" : "Not Connected"}</em></span>
            </div>
            <div className="rm-integrity-row">
              <span className="rm-integrity-dot grey" />
              <span>External traffic API: <em className="rm-not-connected">Not Connected</em></span>
            </div>
            {lastUpdated && <p className="rm-last-updated">Last synced: {lastUpdated.toLocaleString("en-IN")}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
