import { useEffect, useState, useMemo } from "react";
import "./SafetyIntelligence.css";

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

// Safety impact score per damage type (0-100, how dangerous to road users)
const SAFETY_IMPACT = {
  pothole: 85,
  alligator_crack: 80,
  waterlogging: 75,
  road_edge_damage: 70,
  transverse_crack: 55,
  longitudinal_crack: 50,
  repaired_patch: 20,
};

// Vehicle damage risk per damage type
const VEHICLE_RISK = {
  pothole: "High — tyre blowout, suspension damage",
  alligator_crack: "High — vehicle instability on cracked surface",
  waterlogging: "High — aquaplaning, brake failure risk",
  road_edge_damage: "High — vehicle rollover near edges",
  transverse_crack: "Medium — bumpy ride, tyre wear",
  longitudinal_crack: "Medium — steering pull, tyre damage",
  repaired_patch: "Low — minor surface irregularity",
};

// Accident risk per damage type
const ACCIDENT_RISK = {
  pothole: "Very High",
  alligator_crack: "High",
  waterlogging: "Very High",
  road_edge_damage: "High",
  transverse_crack: "Medium",
  longitudinal_crack: "Medium",
  repaired_patch: "Low",
};

const RISK_COLOR = {
  "Very High": "#ff5c6a",
  High: "#ff8c42",
  Medium: "#ffb347",
  Low: "#42d69a",
};

function safetyScoreColor(s) {
  if (s >= 70) return "#42d69a";
  if (s >= 45) return "#ffb347";
  if (s >= 25) return "#ff8c42";
  return "#ff5c6a";
}

function safetyLabel(s) {
  if (s >= 70) return "Safe";
  if (s >= 45) return "Caution";
  if (s >= 25) return "Dangerous";
  return "Critical";
}

function computeSafetyScore(detections) {
  if (!detections || detections.length === 0) return 92;
  const totalImpact = detections.reduce((s, d) => s + (SAFETY_IMPACT[d.damageType] || 50), 0);
  const avgImpact = totalImpact / detections.length;
  return Math.max(0, Math.min(100, Math.round(100 - avgImpact * 0.7)));
}

function RiskBadge({ level, color }) {
  const c = color || RISK_COLOR[level] || "#8494aa";
  return (
    <span className="si-badge" style={{ color: c, background: c + "18", borderColor: c }}>
      {level}
    </span>
  );
}

function ScoreRing({ score, size = 90 }) {
  const r = size * 0.38;
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = safetyScoreColor(score);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1a2a3e" strokeWidth={size * 0.1} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={size * 0.1}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: "stroke-dasharray 0.8s ease" }} />
      <text x={cx} y={cy - 3} textAnchor="middle" fill={color} fontSize={size * 0.19} fontWeight="700">{score}</text>
      <text x={cx} y={cy + size * 0.15} textAnchor="middle" fill="#8494aa" fontSize={size * 0.1}>{safetyLabel(score)}</text>
    </svg>
  );
}

export default function SafetyIntelligence() {
  const [mapData, setMapData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedLoc, setSelectedLoc] = useState(null);
  const [activeTab, setActiveTab] = useState("locations");

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

  const data = useMemo(() => {
    if (!mapData) return null;
    const ai = mapData.aiDetections || [];
    const citizen = mapData.citizenReports || [];

    // Group AI detections by location
    const groups = {};
    ai.forEach(d => {
      const key = (d.locationLabel && d.locationLabel !== "Unknown")
        ? d.locationLabel
        : d.hasGPS ? `${d.latitude?.toFixed(3)},${d.longitude?.toFixed(3)}`
        : "Untagged Scans";
      if (!groups[key]) groups[key] = [];
      groups[key].push(d);
    });

    const locations = Object.entries(groups).map(([loc, dets]) => {
      const safetyScore = computeSafetyScore(dets);
      const avgImpact = dets.reduce((s, d) => s + (SAFETY_IMPACT[d.damageType] || 50), 0) / dets.length;

      // Dominant hazard
      const freq = {};
      dets.forEach(d => { freq[d.damageType] = (freq[d.damageType] || 0) + 1; });
      const dominant = Object.entries(freq).sort((a, b) => {
        return (SAFETY_IMPACT[b[0]] || 0) - (SAFETY_IMPACT[a[0]] || 0);
      })[0];

      // Hazard types present
      const hazards = Object.keys(freq);

      // Overall accident risk
      const maxImpact = Math.max(...dets.map(d => SAFETY_IMPACT[d.damageType] || 0));
      const accidentRisk = maxImpact >= 80 ? "Very High" : maxImpact >= 65 ? "High" : maxImpact >= 45 ? "Medium" : "Low";

      // Vulnerable users affected
      const vulnerableRisks = [];
      if (freq.pothole || freq.waterlogging) vulnerableRisks.push("Two-wheelers");
      if (freq.road_edge_damage) vulnerableRisks.push("Heavy vehicles");
      if (freq.waterlogging) vulnerableRisks.push("Pedestrians");
      if (freq.alligator_crack || freq.pothole) vulnerableRisks.push("All vehicles");

      // Safety warnings
      const warnings = [];
      if (freq.waterlogging) warnings.push("Aquaplaning risk — reduce speed in wet conditions");
      if (freq.pothole) warnings.push("Pothole hazard — risk of tyre damage and loss of control");
      if (freq.alligator_crack) warnings.push("Severely cracked surface — structural instability");
      if (freq.road_edge_damage) warnings.push("Edge drop-off — do not drive near road edges");
      if (freq.longitudinal_crack || freq.transverse_crack) warnings.push("Cracked surface — uneven road, reduce speed");

      const sevCount = { High: 0, Medium: 0, Low: 0 };
      dets.forEach(d => { if (sevCount[d.severity] !== undefined) sevCount[d.severity]++; });

      return {
        location: loc,
        safetyScore,
        avgImpact: Math.round(avgImpact),
        dominant,
        hazards,
        accidentRisk,
        vulnerableRisks: [...new Set(vulnerableRisks)],
        warnings,
        sevCount,
        detectionCount: dets.length,
        detections: dets,
        freq,
      };
    }).sort((a, b) => a.safetyScore - b.safetyScore);

    // Global stats
    const critical = locations.filter(l => l.safetyScore < 25).length;
    const dangerous = locations.filter(l => l.safetyScore >= 25 && l.safetyScore < 45).length;
    const avgSafety = locations.length > 0
      ? Math.round(locations.reduce((s, l) => s + l.safetyScore, 0) / locations.length) : 0;

    // Damage safety impact summary
    const dmgImpact = {};
    ai.forEach(d => {
      if (!dmgImpact[d.damageType]) dmgImpact[d.damageType] = { count: 0, impact: SAFETY_IMPACT[d.damageType] || 50 };
      dmgImpact[d.damageType].count++;
    });

    // Citizen report hazards
    const citizenHazards = citizen.map(r => ({
      location: r.location,
      type: r.reportType,
      status: r.status,
      createdAt: r.createdAt,
    }));

    return { locations, critical, dangerous, avgSafety, dmgImpact, citizenHazards, totalAI: ai.length, totalCitizen: citizen.length };
  }, [mapData]);

  const selected = selectedLoc != null ? data?.locations[selectedLoc] : null;

  if (loading) return <div className="si-loading"><div className="si-spinner" /><p>Loading Safety Intelligence…</p></div>;
  if (error) return <div className="si-error"><span>⚠</span><p>{error}</p></div>;
  if (!data) return null;

  return (
    <div className="si-page">
      {/* Header */}
      <div className="si-header">
        <div>
          <span className="si-eyebrow">SAFETY INTELLIGENCE · LIVE DATABASE · RULE-BASED ANALYSIS</span>
          <h2>Road Safety Intelligence</h2>
          <p>Safety scores, accident risk, hazard analysis and vulnerable user impact — computed from real AI scan data.</p>
        </div>
        <span className="si-live">● LIVE</span>
      </div>

      {/* Summary */}
      <div className="si-summary-row">
        {[
          { val: data.locations.length, label: "Locations Assessed", sub: "From AI scans", color: "#52adff" },
          { val: data.critical, label: "Critical Safety Risk", sub: "Score < 25", color: "#ff5c6a" },
          { val: data.dangerous, label: "Dangerous Locations", sub: "Score 25–44", color: "#ff8c42" },
          { val: data.avgSafety, label: "Avg Safety Score", sub: "Across all locations", color: safetyScoreColor(data.avgSafety) },
          { val: data.totalAI, label: "AI Detections", sub: "Total hazards found", color: "#a78bfa" },
          { val: data.totalCitizen, label: "Citizen Reports", sub: "Community hazards", color: "#ffb347" },
        ].map(s => (
          <div key={s.label} className="si-sum-card" style={{ borderColor: s.color }}>
            <div className="si-sum-val" style={{ color: s.color }}>{s.val}</div>
            <div className="si-sum-label">{s.label}</div>
            <div className="si-sum-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="si-tabs">
        {[["locations","⬡ Location Safety"],["hazards","⚠ Hazard Analysis"],["impact","◎ Damage Impact"],["citizen","♧ Citizen Hazards"]].map(([k, l]) => (
          <button key={k} className={`si-tab ${activeTab === k ? "active" : ""}`} onClick={() => setActiveTab(k)}>{l}</button>
        ))}
      </div>

      {/* TAB: LOCATIONS */}
      {activeTab === "locations" && (
        <div className="si-main-grid">
          <div className="si-loc-list">
            <div className="si-panel-hd">
              <h3>Locations by Safety Score</h3>
              <span className="si-tag">WORST FIRST</span>
            </div>
            {data.locations.length === 0 ? (
              <p className="si-empty">No AI scan data. Run scans from AI Road Scanner.</p>
            ) : data.locations.map((l, i) => (
              <div key={i} className={`si-loc-row ${selectedLoc === i ? "active" : ""}`}
                onClick={() => setSelectedLoc(i)}
                style={{ borderLeftColor: safetyScoreColor(l.safetyScore) }}>
                <div className="si-loc-top">
                  <span className="si-loc-name">{l.location}</span>
                  <RiskBadge level={safetyLabel(l.safetyScore)} color={safetyScoreColor(l.safetyScore)} />
                </div>
                <div className="si-loc-meta">
                  <span>Safety: <b style={{ color: safetyScoreColor(l.safetyScore) }}>{l.safetyScore}</b></span>
                  <span>Accident Risk: <b style={{ color: RISK_COLOR[l.accidentRisk] }}>{l.accidentRisk}</b></span>
                  <span style={{ color: "#5a6a7a" }}>{l.detectionCount} detections</span>
                </div>
                <div className="si-loc-hazard">
                  {l.dominant && <span>⚠ {DAMAGE_LABELS[l.dominant[0]] || l.dominant[0]}</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="si-detail">
            {!selected ? (
              <div className="si-detail-empty">
                <span>⬡</span>
                <p>Select a location to view detailed safety assessment.</p>
              </div>
            ) : (
              <>
                <div className="si-panel-hd">
                  <div>
                    <h3>{selected.location}</h3>
                    <p style={{ color: "#8494aa", fontSize: 11, margin: "4px 0 0" }}>
                      {selected.detectionCount} detections · {selected.hazards.length} hazard types
                    </p>
                  </div>
                  <RiskBadge level={safetyLabel(selected.safetyScore)} color={safetyScoreColor(selected.safetyScore)} />
                </div>

                {/* Score + metrics */}
                <div className="si-score-row">
                  <div className="si-score-center">
                    <ScoreRing score={selected.safetyScore} size={100} />
                    <div className="si-score-label">Safety Score</div>
                  </div>
                  <div className="si-metrics-grid">
                    <div className="si-metric">
                      <div className="si-metric-val" style={{ color: RISK_COLOR[selected.accidentRisk] }}>{selected.accidentRisk}</div>
                      <div className="si-metric-label">Accident Risk</div>
                    </div>
                    <div className="si-metric">
                      <div className="si-metric-val" style={{ color: "#ff8c42" }}>{selected.avgImpact}</div>
                      <div className="si-metric-label">Avg Hazard Impact</div>
                    </div>
                    <div className="si-metric">
                      <div className="si-metric-val" style={{ color: "#a78bfa" }}>{selected.hazards.length}</div>
                      <div className="si-metric-label">Hazard Types</div>
                    </div>
                    <div className="si-metric">
                      <div className="si-metric-val" style={{ color: "#52adff" }}>{selected.detectionCount}</div>
                      <div className="si-metric-label">Total Detections</div>
                    </div>
                  </div>
                </div>

                {/* Safety warnings */}
                {selected.warnings.length > 0 && (
                  <>
                    <div className="si-section-label">⚠ Active Safety Warnings</div>
                    <div className="si-warnings">
                      {selected.warnings.map((w, i) => (
                        <div key={i} className="si-warning-row">
                          <span className="si-warn-dot">●</span>
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Vulnerable users */}
                <div className="si-section-label">Vulnerable Road Users Affected</div>
                <div className="si-vuln-chips">
                  {selected.vulnerableRisks.length > 0
                    ? selected.vulnerableRisks.map(v => (
                      <div key={v} className="si-vuln-chip">⚠ {v}</div>
                    ))
                    : <span className="si-empty-inline">No specific vulnerable user risk identified.</span>
                  }
                </div>

                {/* Hazard breakdown */}
                <div className="si-section-label">Hazard Breakdown</div>
                <div className="si-hazard-list">
                  {Object.entries(selected.freq).sort((a, b) => (SAFETY_IMPACT[b[0]] || 0) - (SAFETY_IMPACT[a[0]] || 0)).map(([type, count]) => {
                    const impact = SAFETY_IMPACT[type] || 50;
                    const ar = ACCIDENT_RISK[type] || "Medium";
                    return (
                      <div key={type} className="si-hazard-row">
                        <div className="si-hazard-info">
                          <div className="si-hazard-name">{DAMAGE_LABELS[type] || type} <span style={{ color: "#5a6a7a" }}>×{count}</span></div>
                          <div className="si-hazard-vehicle">{VEHICLE_RISK[type] || "—"}</div>
                        </div>
                        <div className="si-hazard-right">
                          <div className="si-impact-bar-wrap">
                            <div className="si-impact-bar" style={{ width: `${impact}%`, background: impact >= 75 ? "#ff5c6a" : impact >= 55 ? "#ffb347" : "#42d69a" }} />
                          </div>
                          <RiskBadge level={ar} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Severity */}
                <div className="si-section-label">Severity Distribution</div>
                <div className="si-sev-row">
                  {[["High","#ff5c6a"],["Medium","#ffb347"],["Low","#42d69a"]].map(([s,c]) => (
                    <div key={s} className="si-sev-chip" style={{ borderColor: c, background: c+"18" }}>
                      <span style={{ color: c, fontSize: 20, fontWeight: 700 }}>{selected.sevCount[s]}</span>
                      <span style={{ color: "#8494aa", fontSize: 10 }}>{s}</span>
                    </div>
                  ))}
                </div>

                <p className="si-disclaimer">Safety scores are rule-based estimates. Not a certified road safety audit. Field inspection recommended.</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* TAB: HAZARD ANALYSIS */}
      {activeTab === "hazards" && (
        <div className="si-panel">
          <div className="si-panel-hd">
            <h3>Damage Type Safety Impact</h3>
            <span className="si-tag">ALL DETECTED DAMAGE · SORTED BY IMPACT</span>
          </div>
          <p className="si-panel-desc">Safety impact score (0–100) and accident risk for each damage type found in your database.</p>
          {Object.keys(data.dmgImpact).length === 0 ? (
            <p className="si-empty">No AI detections yet.</p>
          ) : (
            <div className="si-hazard-full-list">
              {Object.entries(data.dmgImpact).sort((a, b) => b[1].impact - a[1].impact).map(([type, info]) => {
                const ar = ACCIDENT_RISK[type] || "Medium";
                const vr = VEHICLE_RISK[type] || "—";
                return (
                  <div key={type} className="si-hazard-full-row">
                    <div className="si-hf-left">
                      <div className="si-hf-name">{DAMAGE_LABELS[type] || type}</div>
                      <div className="si-hf-count">{info.count} detected</div>
                    </div>
                    <div className="si-hf-mid">
                      <div className="si-hf-vehicle">{vr}</div>
                      <div className="si-impact-bar-wrap" style={{ marginTop: 6 }}>
                        <div className="si-impact-bar" style={{
                          width: `${info.impact}%`,
                          background: info.impact >= 75 ? "#ff5c6a" : info.impact >= 55 ? "#ffb347" : "#42d69a"
                        }} />
                      </div>
                    </div>
                    <div className="si-hf-right">
                      <div className="si-hf-impact-val" style={{ color: info.impact >= 75 ? "#ff5c6a" : info.impact >= 55 ? "#ffb347" : "#42d69a" }}>
                        {info.impact}/100
                      </div>
                      <RiskBadge level={ar} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="si-panel-hd" style={{ marginTop: 24 }}>
            <h3>Safety Impact Reference</h3>
            <span className="si-tag">METHODOLOGY</span>
          </div>
          <div className="si-method-grid">
            {[
              ["Safety Score", "100 minus weighted average of safety impact scores of all detected damage types at a location."],
              ["Accident Risk", "Derived from the highest-impact damage type present. Very High = impact ≥ 80."],
              ["Vehicle Risk", "Per-damage-type assessment of likely vehicle damage or loss-of-control scenario."],
              ["Vulnerable Users", "Two-wheelers most affected by potholes/waterlogging. Pedestrians by waterlogging. Heavy vehicles by edge damage."],
            ].map(([t, d]) => (
              <div key={t} className="si-method-card">
                <div className="si-method-title">{t}</div>
                <div className="si-method-desc">{d}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB: DAMAGE IMPACT */}
      {activeTab === "impact" && (
        <div className="si-panel">
          <div className="si-panel-hd">
            <h3>Location Safety Scores — Full Table</h3>
            <span className="si-tag">ALL LOCATIONS · SORTED BY RISK</span>
          </div>
          {data.locations.length === 0 ? (
            <p className="si-empty">No data yet.</p>
          ) : (
            <div className="si-table">
              <div className="si-thead">
                <span>Location</span>
                <span>Safety Score</span>
                <span>Status</span>
                <span>Accident Risk</span>
                <span>Detections</span>
                <span>Dominant Hazard</span>
                <span>Vulnerable Users</span>
              </div>
              {data.locations.map((l, i) => (
                <div key={i} className="si-trow" onClick={() => { setSelectedLoc(i); setActiveTab("locations"); }} style={{ cursor: "pointer" }}>
                  <span className="si-trow-loc">{l.location}</span>
                  <span style={{ color: safetyScoreColor(l.safetyScore), fontWeight: 700 }}>{l.safetyScore}</span>
                  <span><RiskBadge level={safetyLabel(l.safetyScore)} color={safetyScoreColor(l.safetyScore)} /></span>
                  <span style={{ color: RISK_COLOR[l.accidentRisk] }}>{l.accidentRisk}</span>
                  <span>{l.detectionCount}</span>
                  <span style={{ fontSize: 11 }}>{l.dominant ? (DAMAGE_LABELS[l.dominant[0]] || l.dominant[0]) : "—"}</span>
                  <span style={{ fontSize: 10, color: "#8494aa" }}>{l.vulnerableRisks.join(", ") || "—"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB: CITIZEN HAZARDS */}
      {activeTab === "citizen" && (
        <div className="si-panel">
          <div className="si-panel-hd">
            <h3>Citizen-Reported Hazards</h3>
            <span className="si-tag">COMMUNITY DATA · {data.citizenHazards.length} REPORTS</span>
          </div>
          {data.citizenHazards.length === 0 ? (
            <p className="si-empty">No citizen reports yet. Submit reports from the Citizen Reports page.</p>
          ) : (
            <div className="si-citizen-grid">
              {data.citizenHazards.map((r, i) => {
                const isPothole = r.type?.toLowerCase().includes("pothole");
                const isWater = r.type?.toLowerCase().includes("water");
                const risk = isPothole || isWater ? "High" : "Medium";
                return (
                  <div key={i} className="si-citizen-card" style={{ borderColor: RISK_COLOR[risk] }}>
                    <div className="si-citizen-top">
                      <span className="si-citizen-type">{r.type}</span>
                      <RiskBadge level={risk} />
                    </div>
                    <div className="si-citizen-loc">⌖ {r.location}</div>
                    <div className="si-citizen-meta">
                      <span className={`si-citizen-status ${r.status === "Resolved" ? "resolved" : ""}`}>● {r.status}</span>
                      <span style={{ color: "#5a6a7a", fontSize: 10 }}>{r.createdAt?.slice(0, 10) || "—"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
