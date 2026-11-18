import { useEffect, useState, useMemo } from "react";
import "./FailurePrediction.css";

const API_BASE = (
  import.meta.env.VITE_API_URL || "http://127.0.0.1:5001"
).replace(/\/$/, "");

const DAMAGE_LABELS = {
  pothole: "Pothole",
  longitudinal_crack: "Longitudinal Crack",
  transverse_crack: "Transverse Crack",
  alligator_crack: "Alligator Crack",
  waterlogging: "Waterlogging",
  repaired_patch: "Repaired Patch",
  road_edge_damage: "Road Edge Damage",
};

// Deterioration rate per damage type (health points lost per month if untreated)
const DETERIORATION_RATE = {
  pothole: 12,
  alligator_crack: 15,
  waterlogging: 10,
  road_edge_damage: 9,
  longitudinal_crack: 6,
  transverse_crack: 6,
  repaired_patch: 3,
};

// Base health penalty per severity
const SEV_PENALTY = { High: 18, Medium: 9, Low: 4 };

function computeHealth(detections) {
  if (!detections || detections.length === 0) return 95;
  const penalty = detections.reduce((s, d) => s + (SEV_PENALTY[d.severity] || 6), 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

function healthColor(score) {
  if (score >= 70) return "#42d69a";
  if (score >= 45) return "#ffb347";
  if (score >= 25) return "#ff8c42";
  return "#ff5c6a";
}

function healthLabel(score) {
  if (score >= 70) return "Good";
  if (score >= 45) return "Fair";
  if (score >= 25) return "Poor";
  return "Critical";
}

function failureRiskLevel(score30d) {
  if (score30d < 25) return { level: "CRITICAL", color: "#ff5c6a", bg: "#2a0d12", label: "Imminent Failure" };
  if (score30d < 45) return { level: "HIGH", color: "#ff8c42", bg: "#2a1508", label: "High Failure Risk" };
  if (score30d < 65) return { level: "MEDIUM", color: "#ffb347", bg: "#2a1e0a", label: "Moderate Risk" };
  return { level: "LOW", color: "#42d69a", bg: "#0d2a1e", label: "Stable" };
}

function GaugeArc({ score, size = 100 }) {
  const r = size * 0.4;
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = healthColor(score);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1a2a3e" strokeWidth={size * 0.09} />
      <circle
        cx={cx} cy={cy} r={r} fill="none"
        stroke={color} strokeWidth={size * 0.09}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: "stroke-dasharray 0.8s ease" }}
      />
      <text x={cx} y={cy - 4} textAnchor="middle" fill={color} fontSize={size * 0.18} fontWeight="700">{score}</text>
      <text x={cx} y={cy + size * 0.14} textAnchor="middle" fill="#8494aa" fontSize={size * 0.09}>{healthLabel(score)}</text>
    </svg>
  );
}

function TimelineBar({ current, day30, day90 }) {
  const points = [
    { label: "Now", score: current },
    { label: "30d", score: day30 },
    { label: "90d", score: day90 },
  ];
  return (
    <div className="fp-timeline">
      {points.map((p, i) => (
        <div key={p.label} className="fp-tl-point">
          <div className="fp-tl-score" style={{ color: healthColor(p.score) }}>{p.score}</div>
          <div className="fp-tl-bar-wrap">
            <div className="fp-tl-bar-fill" style={{ height: `${p.score}%`, background: healthColor(p.score) }} />
          </div>
          <div className="fp-tl-label">{p.label}</div>
          {i < points.length - 1 && <div className="fp-tl-arrow">→</div>}
        </div>
      ))}
    </div>
  );
}

export default function FailurePrediction() {
  const [mapData, setMapData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedLoc, setSelectedLoc] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/api/map/data`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message);
        setMapData(json);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Build per-location predictions from real AI detections
  const predictions = useMemo(() => {
    if (!mapData) return [];
    const ai = mapData.aiDetections || [];

    // Group by locationLabel (or GPS coords as fallback)
    const groups = {};
    ai.forEach(d => {
      const key = (d.locationLabel && d.locationLabel !== "Unknown")
        ? d.locationLabel
        : d.hasGPS
          ? `${d.latitude?.toFixed(3)},${d.longitude?.toFixed(3)}`
          : "Untagged Scans";
      if (!groups[key]) groups[key] = [];
      groups[key].push(d);
    });

    return Object.entries(groups).map(([loc, detections]) => {
      const currentHealth = computeHealth(detections);

      // Deterioration rate = weighted avg of damage types detected
      const totalRate = detections.reduce((s, d) => s + (DETERIORATION_RATE[d.damageType] || 5), 0);
      const avgRate = detections.length > 0 ? totalRate / detections.length : 2;

      // Projected health
      const health30d = Math.max(0, Math.round(currentHealth - avgRate * 1));
      const health90d = Math.max(0, Math.round(currentHealth - avgRate * 3));

      // Trend
      const drop = currentHealth - health90d;
      const trend = drop > 20 ? "Rapid Decline" : drop > 10 ? "Gradual Decline" : drop > 3 ? "Slow Decline" : "Stable";

      // Dominant damage
      const dmgFreq = {};
      detections.forEach(d => { dmgFreq[d.damageType] = (dmgFreq[d.damageType] || 0) + 1; });
      const dominantDmg = Object.entries(dmgFreq).sort((a, b) => b[1] - a[1])[0];

      // Severity counts
      const sevCount = { High: 0, Medium: 0, Low: 0 };
      detections.forEach(d => { if (sevCount[d.severity] !== undefined) sevCount[d.severity]++; });

      // Failure risk
      const risk = failureRiskLevel(health30d);

      // Days to critical (health < 25)
      const daysToCritical = currentHealth <= 25 ? 0
        : avgRate > 0 ? Math.round((currentHealth - 25) / (avgRate / 30)) : 999;

      // Recommended action
      let action, urgency;
      if (health30d < 25) {
        action = "Emergency intervention required. Road at imminent failure risk.";
        urgency = "Within 48 hours";
      } else if (health30d < 45) {
        action = "Schedule repair within 1–2 weeks before further deterioration.";
        urgency = "Within 2 weeks";
      } else if (health30d < 65) {
        action = "Plan preventive maintenance within 1 month.";
        urgency = "Within 1 month";
      } else {
        action = "Continue monitoring. Include in next maintenance cycle.";
        urgency = "Next cycle";
      }

      return {
        location: loc,
        detectionCount: detections.length,
        currentHealth,
        health30d,
        health90d,
        avgRate: Math.round(avgRate * 10) / 10,
        trend,
        dominantDmg,
        sevCount,
        risk,
        daysToCritical,
        action,
        urgency,
        detections,
      };
    }).sort((a, b) => a.health30d - b.health30d); // worst first
  }, [mapData]);

  // Global summary stats
  const summary = useMemo(() => {
    if (!predictions.length) return null;
    const critical = predictions.filter(p => p.risk.level === "CRITICAL").length;
    const high = predictions.filter(p => p.risk.level === "HIGH").length;
    const avgHealth = Math.round(predictions.reduce((s, p) => s + p.currentHealth, 0) / predictions.length);
    const avgHealth30 = Math.round(predictions.reduce((s, p) => s + p.health30d, 0) / predictions.length);
    const worstLoc = predictions[0];
    return { critical, high, avgHealth, avgHealth30, worstLoc, total: predictions.length };
  }, [predictions]);

  const selected = selectedLoc != null ? predictions[selectedLoc] : null;

  if (loading) return (
    <div className="fp-loading"><div className="fp-spinner" /><p>Computing failure predictions…</p></div>
  );
  if (error) return (
    <div className="fp-error"><span>⚠</span><p>Could not load data: {error}</p></div>
  );

  return (
    <div className="fp-page">
      {/* Header */}
      <div className="fp-header">
        <div>
          <span className="fp-eyebrow">PREDICTIVE ANALYTICS · RULE-BASED MODEL · LIVE DATA</span>
          <h2>Road Failure Prediction</h2>
          <p>Deterioration projections computed from real AI scan data. Predicts road health at 30 and 90 days if no repair is done.</p>
        </div>
        <span className="fp-live">● LIVE</span>
      </div>

      {predictions.length === 0 ? (
        <div className="fp-empty-state">
          <div className="fp-empty-icon">↗</div>
          <h3>No Scan Data Available</h3>
          <p>Run AI road scans from the AI Road Scanner to generate failure predictions. Each scan with a location label creates a prediction entry here.</p>
        </div>
      ) : (
        <>
          {/* Summary stats */}
          {summary && (
            <div className="fp-summary-row">
              <div className="fp-sum-card" style={{ borderColor: "#ff5c6a" }}>
                <div className="fp-sum-val" style={{ color: "#ff5c6a" }}>{summary.critical}</div>
                <div className="fp-sum-label">Imminent Failure</div>
                <div className="fp-sum-sub">Health &lt; 25 in 30 days</div>
              </div>
              <div className="fp-sum-card" style={{ borderColor: "#ff8c42" }}>
                <div className="fp-sum-val" style={{ color: "#ff8c42" }}>{summary.high}</div>
                <div className="fp-sum-label">High Failure Risk</div>
                <div className="fp-sum-sub">Health &lt; 45 in 30 days</div>
              </div>
              <div className="fp-sum-card" style={{ borderColor: "#52adff" }}>
                <div className="fp-sum-val" style={{ color: "#52adff" }}>{summary.total}</div>
                <div className="fp-sum-label">Locations Tracked</div>
                <div className="fp-sum-sub">From AI scan data</div>
              </div>
              <div className="fp-sum-card" style={{ borderColor: healthColor(summary.avgHealth) }}>
                <div className="fp-sum-val" style={{ color: healthColor(summary.avgHealth) }}>{summary.avgHealth}</div>
                <div className="fp-sum-label">Avg Health Now</div>
                <div className="fp-sum-sub">Across all locations</div>
              </div>
              <div className="fp-sum-card" style={{ borderColor: healthColor(summary.avgHealth30) }}>
                <div className="fp-sum-val" style={{ color: healthColor(summary.avgHealth30) }}>{summary.avgHealth30}</div>
                <div className="fp-sum-label">Avg Health in 30d</div>
                <div className="fp-sum-sub">Projected if untreated</div>
              </div>
            </div>
          )}

          <div className="fp-main-grid">
            {/* Left: location list */}
            <div className="fp-loc-list">
              <div className="fp-panel-hd">
                <h3>Locations by Failure Risk</h3>
                <span className="fp-tag">WORST FIRST</span>
              </div>
              <p className="fp-panel-desc">Click a location to see detailed prediction.</p>
              {predictions.map((p, i) => (
                <div
                  key={i}
                  className={`fp-loc-row ${selectedLoc === i ? "active" : ""}`}
                  onClick={() => setSelectedLoc(i)}
                  style={{ borderLeftColor: p.risk.color }}
                >
                  <div className="fp-loc-top">
                    <span className="fp-loc-name">{p.location}</span>
                    <span className="fp-risk-badge" style={{ color: p.risk.color, background: p.risk.bg, borderColor: p.risk.color }}>
                      {p.risk.level}
                    </span>
                  </div>
                  <div className="fp-loc-meta">
                    <span>Now: <b style={{ color: healthColor(p.currentHealth) }}>{p.currentHealth}</b></span>
                    <span>30d: <b style={{ color: healthColor(p.health30d) }}>{p.health30d}</b></span>
                    <span>90d: <b style={{ color: healthColor(p.health90d) }}>{p.health90d}</b></span>
                    <span style={{ color: "#5a6a7a" }}>{p.detectionCount} detections</span>
                  </div>
                  <div className="fp-loc-trend" style={{ color: p.trend === "Rapid Decline" ? "#ff5c6a" : p.trend === "Gradual Decline" ? "#ffb347" : "#42d69a" }}>
                    {p.trend === "Rapid Decline" ? "↘ " : p.trend === "Gradual Decline" ? "↘ " : p.trend === "Slow Decline" ? "→ " : "→ "}{p.trend}
                  </div>
                </div>
              ))}
            </div>

            {/* Right: detail panel */}
            <div className="fp-detail">
              {!selected ? (
                <div className="fp-detail-empty">
                  <span>↗</span>
                  <p>Select a location from the list to view detailed failure prediction.</p>
                </div>
              ) : (
                <>
                  <div className="fp-panel-hd">
                    <div>
                      <h3>{selected.location}</h3>
                      <p style={{ color: "#8494aa", fontSize: 11, margin: "4px 0 0" }}>{selected.detectionCount} AI detections · {selected.dominantDmg ? `Dominant: ${DAMAGE_LABELS[selected.dominantDmg[0]] || selected.dominantDmg[0]}` : ""}</p>
                    </div>
                    <span className="fp-risk-badge" style={{ color: selected.risk.color, background: selected.risk.bg, borderColor: selected.risk.color, fontSize: 11, padding: "5px 10px" }}>
                      {selected.risk.label}
                    </span>
                  </div>

                  {/* Health gauges */}
                  <div className="fp-gauges">
                    {[
                      { label: "Current Health", score: selected.currentHealth, sub: "Based on detections" },
                      { label: "30-Day Projection", score: selected.health30d, sub: "If untreated" },
                      { label: "90-Day Projection", score: selected.health90d, sub: "If untreated" },
                    ].map(g => (
                      <div key={g.label} className="fp-gauge-card">
                        <GaugeArc score={g.score} size={96} />
                        <div className="fp-gauge-label">{g.label}</div>
                        <div className="fp-gauge-sub">{g.sub}</div>
                      </div>
                    ))}
                  </div>

                  {/* Timeline bar */}
                  <div className="fp-section-label">Health Trajectory</div>
                  <TimelineBar current={selected.currentHealth} day30={selected.health30d} day90={selected.health90d} />

                  {/* Key metrics */}
                  <div className="fp-metrics-grid">
                    <div className="fp-metric">
                      <div className="fp-metric-val" style={{ color: "#ff8c42" }}>{selected.avgRate}/mo</div>
                      <div className="fp-metric-label">Deterioration Rate</div>
                    </div>
                    <div className="fp-metric">
                      <div className="fp-metric-val" style={{ color: selected.daysToCritical < 30 ? "#ff5c6a" : selected.daysToCritical < 90 ? "#ffb347" : "#42d69a" }}>
                        {selected.daysToCritical >= 999 ? "Stable" : `${selected.daysToCritical}d`}
                      </div>
                      <div className="fp-metric-label">Days to Critical</div>
                    </div>
                    <div className="fp-metric">
                      <div className="fp-metric-val" style={{ color: "#a78bfa" }}>{selected.detectionCount}</div>
                      <div className="fp-metric-label">Total Detections</div>
                    </div>
                    <div className="fp-metric">
                      <div className="fp-metric-val" style={{ color: "#52adff" }}>{selected.currentHealth - selected.health90d}</div>
                      <div className="fp-metric-label">90d Health Drop</div>
                    </div>
                  </div>

                  {/* Severity breakdown */}
                  <div className="fp-section-label">Severity Breakdown</div>
                  <div className="fp-sev-row">
                    {[["High", "#ff5c6a"], ["Medium", "#ffb347"], ["Low", "#42d69a"]].map(([s, c]) => (
                      <div key={s} className="fp-sev-chip" style={{ borderColor: c, background: c + "18" }}>
                        <span style={{ color: c, fontSize: 18, fontWeight: 700 }}>{selected.sevCount[s]}</span>
                        <span style={{ color: "#8494aa", fontSize: 10 }}>{s}</span>
                      </div>
                    ))}
                  </div>

                  {/* Damage types */}
                  <div className="fp-section-label">Detected Damage Types</div>
                  <div className="fp-dmg-chips">
                    {Object.entries(
                      selected.detections.reduce((acc, d) => {
                        acc[d.damageType] = (acc[d.damageType] || 0) + 1;
                        return acc;
                      }, {})
                    ).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                      <div key={type} className="fp-dmg-chip">
                        <span>{DAMAGE_LABELS[type] || type}</span>
                        <span className="fp-dmg-count">{count}×</span>
                      </div>
                    ))}
                  </div>

                  {/* Recommended action */}
                  <div className="fp-action-box" style={{ borderColor: selected.risk.color, background: selected.risk.bg }}>
                    <div className="fp-action-top">
                      <span style={{ color: selected.risk.color, fontWeight: 700, fontSize: 12 }}>⚙ Recommended Action</span>
                      <span className="fp-urgency" style={{ color: selected.risk.color, borderColor: selected.risk.color }}>
                        {selected.urgency}
                      </span>
                    </div>
                    <p className="fp-action-text">{selected.action}</p>
                  </div>

                  <p className="fp-disclaimer">
                    Predictions are rule-based estimates using deterioration rates per damage type. Not a certified structural assessment. Field inspection recommended.
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Bottom: all locations table */}
          <div className="fp-panel fp-table-panel">
            <div className="fp-panel-hd">
              <h3>All Location Predictions</h3>
              <span className="fp-tag">FULL TABLE · SORTED BY RISK</span>
            </div>
            <div className="fp-table">
              <div className="fp-thead">
                <span>Location</span>
                <span>Detections</span>
                <span>Health Now</span>
                <span>Health 30d</span>
                <span>Health 90d</span>
                <span>Rate/mo</span>
                <span>Trend</span>
                <span>Risk</span>
                <span>Action By</span>
              </div>
              {predictions.map((p, i) => (
                <div key={i} className="fp-trow" onClick={() => setSelectedLoc(i)} style={{ cursor: "pointer" }}>
                  <span className="fp-trow-loc">{p.location}</span>
                  <span>{p.detectionCount}</span>
                  <span style={{ color: healthColor(p.currentHealth), fontWeight: 600 }}>{p.currentHealth}</span>
                  <span style={{ color: healthColor(p.health30d), fontWeight: 600 }}>{p.health30d}</span>
                  <span style={{ color: healthColor(p.health90d), fontWeight: 600 }}>{p.health90d}</span>
                  <span style={{ color: "#ff8c42" }}>{p.avgRate}</span>
                  <span style={{ color: p.trend === "Rapid Decline" ? "#ff5c6a" : p.trend === "Gradual Decline" ? "#ffb347" : "#42d69a", fontSize: 11 }}>{p.trend}</span>
                  <span>
                    <span className="fp-risk-badge" style={{ color: p.risk.color, background: p.risk.bg, borderColor: p.risk.color }}>
                      {p.risk.level}
                    </span>
                  </span>
                  <span style={{ color: "#8494aa", fontSize: 11 }}>{p.urgency}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
