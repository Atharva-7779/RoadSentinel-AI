import { useEffect, useState, useMemo } from "react";
import "./RoadIntelligence.css";

const API_BASE = "http://127.0.0.1:5001";

const DAMAGE_LABELS = {
  pothole: "Pothole",
  longitudinal_crack: "Longitudinal Crack",
  transverse_crack: "Transverse Crack",
  alligator_crack: "Alligator Crack",
  waterlogging: "Waterlogging",
  repaired_patch: "Repaired Patch",
  road_edge_damage: "Road Edge Damage",
};

const SEVERITY_COLOR = { High: "#ff5c6a", Medium: "#ffb347", Low: "#42d69a" };

function StatCard({ icon, label, value, sub, color }) {
  return (
    <div className="ri-stat">
      <div className="ri-stat-icon" style={{ color: color || "#52adff" }}>{icon}</div>
      <div>
        <div className="ri-stat-val" style={{ color: color || "#eaf0fa" }}>{value}</div>
        <div className="ri-stat-label">{label}</div>
        {sub && <div className="ri-stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

function MiniBar({ label, value, max, color }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="ri-minibar-row">
      <span className="ri-minibar-label">{label}</span>
      <div className="ri-minibar-track">
        <div className="ri-minibar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="ri-minibar-val">{value}</span>
    </div>
  );
}

function RiskBadge({ level }) {
  const map = {
    CRITICAL: { color: "#ff5c6a", bg: "#2a0d12" },
    HIGH: { color: "#ff8c42", bg: "#2a1508" },
    MEDIUM: { color: "#ffb347", bg: "#2a1e0a" },
    LOW: { color: "#42d69a", bg: "#0d2a1e" },
  };
  const s = map[level] || map.LOW;
  return (
    <span className="ri-risk-badge" style={{ color: s.color, background: s.bg, borderColor: s.color }}>
      {level}
    </span>
  );
}

export default function RoadIntelligence() {
  const [mapData, setMapData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");

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

  const intel = useMemo(() => {
    if (!mapData) return null;
    const ai = mapData.aiDetections || [];
    const citizen = mapData.citizenReports || [];
    const all = [...ai, ...citizen];

    // Damage type frequency
    const damageFreq = {};
    ai.forEach(d => {
      const k = d.damageType;
      damageFreq[k] = (damageFreq[k] || 0) + 1;
    });

    // Severity breakdown
    const sevCount = { High: 0, Medium: 0, Low: 0 };
    ai.forEach(d => { if (sevCount[d.severity] !== undefined) sevCount[d.severity]++; });

    // Risk level breakdown
    const riskCount = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    all.forEach(d => { if (riskCount[d.riskLevel] !== undefined) riskCount[d.riskLevel]++; });

    // Average confidence
    const withConf = ai.filter(d => d.confidence != null);
    const avgConf = withConf.length > 0
      ? (withConf.reduce((s, d) => s + d.confidence, 0) / withConf.length).toFixed(1)
      : "N/A";

    // Top damage type
    const topDamage = Object.entries(damageFreq).sort((a, b) => b[1] - a[1])[0];

    // Locations with GPS
    const gpsDetections = ai.filter(d => d.hasGPS);

    // Recent 10 AI scans
    const recent = [...ai].slice(0, 10);

    // Health score distribution
    const healthBuckets = { "80-100 Good": 0, "60-79 Fair": 0, "40-59 Poor": 0, "0-39 Critical": 0 };
    ai.forEach(d => {
      const weights = { High: 18, Medium: 9, Low: 4 };
      const score = Math.max(0, 100 - (weights[d.severity] || 6));
      if (score >= 80) healthBuckets["80-100 Good"]++;
      else if (score >= 60) healthBuckets["60-79 Fair"]++;
      else if (score >= 40) healthBuckets["40-59 Poor"]++;
      else healthBuckets["0-39 Critical"]++;
    });

    // Unique locations scanned
    const uniqueLocs = new Set(ai.filter(d => d.locationLabel && d.locationLabel !== "Unknown").map(d => d.locationLabel));

    return {
      totalAI: ai.length,
      totalCitizen: citizen.length,
      totalAll: all.length,
      damageFreq,
      sevCount,
      riskCount,
      avgConf,
      topDamage,
      gpsDetections,
      recent,
      healthBuckets,
      uniqueLocs: uniqueLocs.size,
      stats: mapData.stats,
    };
  }, [mapData]);

  if (loading) return (
    <div className="ri-loading">
      <div className="ri-spinner" />
      <p>Loading Road Intelligence…</p>
    </div>
  );

  if (error) return (
    <div className="ri-error">
      <span>⚠</span>
      <p>Could not load data: {error}</p>
    </div>
  );

  if (!intel) return null;

  const maxDmg = Math.max(...Object.values(intel.damageFreq), 1);
  const maxRisk = Math.max(...Object.values(intel.riskCount), 1);

  return (
    <div className="ri-page">
      {/* Header */}
      <div className="ri-header">
        <div>
          <span className="ri-eyebrow">ROAD INTELLIGENCE · LIVE DATABASE</span>
          <h2>Road Intelligence Dashboard</h2>
          <p>Real-time analysis from AI scans and citizen reports stored in your database.</p>
        </div>
        <div className="ri-header-badges">
          <span className="ri-live-dot">● LIVE</span>
          <span className="ri-source-tag">{intel.totalAI} AI Detections · {intel.totalCitizen} Citizen Reports</span>
        </div>
      </div>

      {/* Top stats */}
      <div className="ri-stats-row">
        <StatCard icon="◎" label="Total AI Detections" value={intel.totalAI} sub="From YOLO scans" color="#52adff" />
        <StatCard icon="♧" label="Citizen Reports" value={intel.totalCitizen} sub="Submitted reports" color="#a78bfa" />
        <StatCard icon="⚠" label="Critical Risk" value={intel.riskCount.CRITICAL} sub="Needs immediate action" color="#ff5c6a" />
        <StatCard icon="↗" label="High Risk" value={intel.riskCount.HIGH} sub="Schedule repair soon" color="#ff8c42" />
        <StatCard icon="◈" label="Avg AI Confidence" value={intel.avgConf !== "N/A" ? `${intel.avgConf}%` : "N/A"} sub="Model certainty" color="#42d69a" />
        <StatCard icon="⌖" label="GPS-Tagged Scans" value={intel.gpsDetections.length} sub="Mappable detections" color="#ffb347" />
      </div>

      {/* Tabs */}
      <div className="ri-tabs">
        {[
          ["overview", "◫ Overview"],
          ["damage", "◎ Damage Analysis"],
          ["risk", "⚠ Risk Breakdown"],
          ["scans", "▤ Recent Scans"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`ri-tab ${activeTab === key ? "active" : ""}`}
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab: Overview */}
      {activeTab === "overview" && (
        <div className="ri-tab-content">
          <div className="ri-two-col">
            {/* Severity breakdown */}
            <div className="ri-panel">
              <div className="ri-panel-hd">
                <h3>Severity Distribution</h3>
                <span className="ri-tag">AI DETECTED</span>
              </div>
              <div className="ri-sev-grid">
                {[
                  ["High", intel.sevCount.High, "#ff5c6a", "#2a0d12"],
                  ["Medium", intel.sevCount.Medium, "#ffb347", "#2a1e0a"],
                  ["Low", intel.sevCount.Low, "#42d69a", "#0d2a1e"],
                ].map(([label, count, color, bg]) => (
                  <div key={label} className="ri-sev-card" style={{ borderColor: color, background: bg }}>
                    <div className="ri-sev-count" style={{ color }}>{count}</div>
                    <div className="ri-sev-label">{label} Severity</div>
                    <div className="ri-sev-pct" style={{ color }}>
                      {intel.totalAI > 0 ? Math.round((count / intel.totalAI) * 100) : 0}%
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 20 }}>
                <p className="ri-sub-label">Severity Bars</p>
                <MiniBar label="High" value={intel.sevCount.High} max={intel.totalAI} color="#ff5c6a" />
                <MiniBar label="Medium" value={intel.sevCount.Medium} max={intel.totalAI} color="#ffb347" />
                <MiniBar label="Low" value={intel.sevCount.Low} max={intel.totalAI} color="#42d69a" />
              </div>
            </div>

            {/* Health score distribution */}
            <div className="ri-panel">
              <div className="ri-panel-hd">
                <h3>Road Health Distribution</h3>
                <span className="ri-tag">RULE-BASED</span>
              </div>
              <p className="ri-panel-desc">Health score estimated per detection based on severity penalty model.</p>
              {Object.entries(intel.healthBuckets).map(([bucket, count]) => {
                const color = bucket.includes("Good") ? "#42d69a" : bucket.includes("Fair") ? "#ffb347" : bucket.includes("Poor") ? "#ff8c42" : "#ff5c6a";
                return (
                  <MiniBar key={bucket} label={bucket} value={count} max={intel.totalAI} color={color} />
                );
              })}
              <div className="ri-insight-box" style={{ marginTop: 16 }}>
                <span>💡</span>
                <p>
                  {intel.sevCount.High > intel.sevCount.Medium + intel.sevCount.Low
                    ? "Majority of detections are High severity — immediate repair planning recommended."
                    : intel.sevCount.Medium > intel.sevCount.High
                    ? "Medium severity dominates — schedule preventive maintenance."
                    : "Road health is relatively stable — continue monitoring."}
                </p>
              </div>
            </div>
          </div>

          {/* Top damage + unique locations */}
          <div className="ri-two-col" style={{ marginTop: 16 }}>
            <div className="ri-panel">
              <div className="ri-panel-hd">
                <h3>Most Detected Damage</h3>
                <span className="ri-tag">AI DETECTED</span>
              </div>
              {intel.topDamage ? (
                <div className="ri-top-damage">
                  <div className="ri-top-damage-name">{DAMAGE_LABELS[intel.topDamage[0]] || intel.topDamage[0]}</div>
                  <div className="ri-top-damage-count">{intel.topDamage[1]} detections</div>
                  <div className="ri-top-damage-pct">
                    {Math.round((intel.topDamage[1] / intel.totalAI) * 100)}% of all AI detections
                  </div>
                </div>
              ) : (
                <p className="ri-empty">No AI detections yet.</p>
              )}
            </div>

            <div className="ri-panel">
              <div className="ri-panel-hd">
                <h3>Coverage Summary</h3>
                <span className="ri-tag">DATABASE</span>
              </div>
              <div className="ri-coverage-grid">
                <div className="ri-cov-item">
                  <div className="ri-cov-val">{intel.uniqueLocs}</div>
                  <div className="ri-cov-label">Unique Locations Scanned</div>
                </div>
                <div className="ri-cov-item">
                  <div className="ri-cov-val">{intel.gpsDetections.length}</div>
                  <div className="ri-cov-label">GPS-Tagged Detections</div>
                </div>
                <div className="ri-cov-item">
                  <div className="ri-cov-val">{intel.totalCitizen}</div>
                  <div className="ri-cov-label">Citizen Reports Filed</div>
                </div>
                <div className="ri-cov-item">
                  <div className="ri-cov-val">{intel.stats?.resolvedReports ?? 0}</div>
                  <div className="ri-cov-label">Reports Resolved</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Damage Analysis */}
      {activeTab === "damage" && (
        <div className="ri-tab-content">
          <div className="ri-panel">
            <div className="ri-panel-hd">
              <h3>Damage Type Frequency</h3>
              <span className="ri-tag">AI DETECTED · ALL SCANS</span>
            </div>
            <p className="ri-panel-desc">Count of each damage class detected by the YOLO model across all scanned images.</p>
            {Object.keys(intel.damageFreq).length === 0 ? (
              <p className="ri-empty">No AI detections in database yet. Run scans from the AI Road Scanner.</p>
            ) : (
              <div className="ri-damage-list">
                {Object.entries(intel.damageFreq)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count], i) => {
                    const pct = Math.round((count / maxDmg) * 100);
                    const sev = { pothole: "High", alligator_crack: "High", waterlogging: "High", road_edge_damage: "High", longitudinal_crack: "Medium", transverse_crack: "Medium", repaired_patch: "Low" }[type] || "Medium";
                    const color = SEVERITY_COLOR[sev];
                    return (
                      <div key={type} className="ri-damage-row">
                        <div className="ri-damage-rank">#{i + 1}</div>
                        <div className="ri-damage-info">
                          <div className="ri-damage-name">{DAMAGE_LABELS[type] || type}</div>
                          <div className="ri-damage-bar-wrap">
                            <div className="ri-damage-bar" style={{ width: `${pct}%`, background: color }} />
                          </div>
                        </div>
                        <div className="ri-damage-meta">
                          <span className="ri-damage-count">{count}</span>
                          <RiskBadge level={sev === "High" ? "HIGH" : sev === "Medium" ? "MEDIUM" : "LOW"} />
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          <div className="ri-panel" style={{ marginTop: 16 }}>
            <div className="ri-panel-hd">
              <h3>Damage Intelligence Notes</h3>
              <span className="ri-tag">RULE-BASED INFERENCE</span>
            </div>
            <div className="ri-notes-grid">
              {[
                { type: "pothole", icon: "⬤", note: "Potholes form due to water infiltration + traffic load. Require immediate patching." },
                { type: "alligator_crack", icon: "⬡", note: "Alligator cracking indicates structural base failure. Full resurfacing needed." },
                { type: "longitudinal_crack", icon: "—", note: "Longitudinal cracks from thermal stress or lane joint failure. Seal before water enters." },
                { type: "transverse_crack", icon: "⊥", note: "Transverse cracks from temperature cycling. Crack sealing extends pavement life." },
                { type: "waterlogging", icon: "◈", note: "Standing water accelerates all damage types. Drainage repair is priority." },
                { type: "repaired_patch", icon: "◻", note: "Patched areas need monitoring — re-deterioration common within 1–2 years." },
                { type: "road_edge_damage", icon: "◁", note: "Edge damage from shoulder erosion. Risk of road widening failure under heavy vehicles." },
              ].filter(n => intel.damageFreq[n.type] > 0).map(n => (
                <div key={n.type} className="ri-note-card">
                  <div className="ri-note-icon">{n.icon}</div>
                  <div>
                    <div className="ri-note-type">{DAMAGE_LABELS[n.type]}</div>
                    <div className="ri-note-text">{n.note}</div>
                    <div className="ri-note-count">{intel.damageFreq[n.type]} detected</div>
                  </div>
                </div>
              ))}
              {Object.keys(intel.damageFreq).length === 0 && (
                <p className="ri-empty">No damage data yet.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab: Risk Breakdown */}
      {activeTab === "risk" && (
        <div className="ri-tab-content">
          <div className="ri-two-col">
            <div className="ri-panel">
              <div className="ri-panel-hd">
                <h3>Risk Level Distribution</h3>
                <span className="ri-tag">ALL SOURCES</span>
              </div>
              <p className="ri-panel-desc">Combined risk levels from AI detections and citizen reports.</p>
              {[
                ["CRITICAL", "#ff5c6a", "#2a0d12"],
                ["HIGH", "#ff8c42", "#2a1508"],
                ["MEDIUM", "#ffb347", "#2a1e0a"],
                ["LOW", "#42d69a", "#0d2a1e"],
              ].map(([level, color, bg]) => (
                <div key={level} className="ri-risk-row" style={{ borderColor: color, background: bg }}>
                  <div>
                    <div className="ri-risk-level" style={{ color }}>{level}</div>
                    <div className="ri-risk-bar-wrap">
                      <div className="ri-risk-bar" style={{ width: `${Math.round((intel.riskCount[level] / Math.max(intel.totalAll, 1)) * 100)}%`, background: color }} />
                    </div>
                  </div>
                  <div className="ri-risk-count" style={{ color }}>{intel.riskCount[level]}</div>
                </div>
              ))}
            </div>

            <div className="ri-panel">
              <div className="ri-panel-hd">
                <h3>Risk Score Methodology</h3>
                <span className="ri-tag">HOW IT WORKS</span>
              </div>
              <div className="ri-method-list">
                {[
                  ["AI Detection Score", "Base score from damage severity × AI confidence. High severity = 75 base, Medium = 50, Low = 25."],
                  ["Citizen Report Score", "Based on reported damage type. Pothole = High risk base (75). Other types = Medium (50)."],
                  ["CRITICAL threshold", "Risk score ≥ 75 — immediate inspection required."],
                  ["HIGH threshold", "Risk score 55–74 — schedule repair within 2 weeks."],
                  ["MEDIUM threshold", "Risk score 35–54 — plan repair within 1 month."],
                  ["LOW threshold", "Risk score < 35 — monitor, include in next cycle."],
                ].map(([title, desc]) => (
                  <div key={title} className="ri-method-row">
                    <div className="ri-method-title">{title}</div>
                    <div className="ri-method-desc">{desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="ri-panel" style={{ marginTop: 16 }}>
            <div className="ri-panel-hd">
              <h3>Action Recommendations</h3>
              <span className="ri-tag">RULE-BASED</span>
            </div>
            <div className="ri-action-grid">
              {[
                { level: "CRITICAL", count: intel.riskCount.CRITICAL, color: "#ff5c6a", bg: "#2a0d12", action: "Emergency patching within 48 hours. Deploy inspection team immediately.", urgency: "URGENT" },
                { level: "HIGH", count: intel.riskCount.HIGH, color: "#ff8c42", bg: "#2a1508", action: "Schedule repair within 1–2 weeks. Allocate maintenance budget.", urgency: "HIGH" },
                { level: "MEDIUM", count: intel.riskCount.MEDIUM, color: "#ffb347", bg: "#2a1e0a", action: "Plan preventive maintenance within 1 month. Monitor for deterioration.", urgency: "MEDIUM" },
                { level: "LOW", count: intel.riskCount.LOW, color: "#42d69a", bg: "#0d2a1e", action: "Include in next scheduled maintenance cycle. Continue monitoring.", urgency: "LOW" },
              ].map(r => (
                <div key={r.level} className="ri-action-card" style={{ borderColor: r.color, background: r.bg }}>
                  <div className="ri-action-top">
                    <span className="ri-action-level" style={{ color: r.color }}>{r.level}</span>
                    <span className="ri-action-count" style={{ color: r.color }}>{r.count} locations</span>
                  </div>
                  <p className="ri-action-text">{r.action}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab: Recent Scans */}
      {activeTab === "scans" && (
        <div className="ri-tab-content">
          <div className="ri-panel">
            <div className="ri-panel-hd">
              <h3>Recent AI Scan Results</h3>
              <span className="ri-tag">LIVE DATABASE · LATEST 10</span>
            </div>
            {intel.recent.length === 0 ? (
              <p className="ri-empty">No AI scans yet. Use the AI Road Scanner to scan road images.</p>
            ) : (
              <div className="ri-scan-table">
                <div className="ri-scan-thead">
                  <span>Damage Type</span>
                  <span>Severity</span>
                  <span>Confidence</span>
                  <span>Risk</span>
                  <span>Location</span>
                  <span>Scanned At</span>
                </div>
                {intel.recent.map((d, i) => (
                  <div key={i} className="ri-scan-row">
                    <span>{DAMAGE_LABELS[d.damageType] || d.damageType}</span>
                    <span style={{ color: SEVERITY_COLOR[d.severity] }}>{d.severity}</span>
                    <span>{d.confidence != null ? `${d.confidence.toFixed(1)}%` : "—"}</span>
                    <span><RiskBadge level={d.riskLevel} /></span>
                    <span className="ri-scan-loc">{d.locationLabel !== "Unknown" ? d.locationLabel : d.hasGPS ? `${d.latitude?.toFixed(4)}, ${d.longitude?.toFixed(4)}` : "—"}</span>
                    <span className="ri-scan-date">{d.scannedAt?.slice(0, 16).replace("T", " ") || "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <p className="ri-disclaimer">
        All scores and recommendations are rule-based estimates derived from AI detections and citizen reports. Not a certified structural assessment. Field verification recommended.
      </p>
    </div>
  );
}
