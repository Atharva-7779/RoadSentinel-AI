

import { useEffect, useState } from "react";
import "./App.css";
import MapView from "./components/MapView";
import RoadScanner from "./components/scanner/RoadScanner";
import RoadIntelligence from "./components/RoadIntelligence";
import FailurePrediction from "./components/FailurePrediction";
import SafetyIntelligence from "./components/SafetyIntelligence";

const API_BASE = "http://127.0.0.1:5001";

const navigation = [
  ["Overview", "◫"],
  ["Live Risk Map", "⌖"],
  ["AI Road Scanner", "◎"],
  ["Road Intelligence", "▤"],
  ["Failure Prediction", "↗"],
  ["Safety Intelligence", "⬡"],
  ["Repair Priority", "⚙"],
  ["Citizen Reports", "♧"],
  ["Analytics", "▥"],
];

function App() {
  const [active, setActive] = useState("Overview");

  const [reports, setReports] = useState([]);
  const [reportType, setReportType] = useState("Pothole");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingReports, setLoadingReports] = useState(false);

  const stats = [
    {
      title: "Roads Monitored",
      value: "12,480",
      change: "Demo metric",
      icon: "⌁",
    },
    {
      title: "Critical Risk",
      value: "248",
      change: "Requires inspection",
      icon: "⚠",
    },
    {
      title: "Citizen Reports",
      value: "1,842",
      change: "Sample reports",
      icon: "♧",
    },
    {
      title: "Repairs Tracked",
      value: "684",
      change: "Sample records",
      icon: "✓",
    },
  ];

  async function loadReports() {
    setLoadingReports(true);

    try {
      const response = await fetch(`${API_BASE}/api/reports`);
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not load reports.");
      }

      const formattedReports = data.reports.map((report) => ({
        ...report,
        photo: report.photo ? `${API_BASE}${report.photo}` : null,
      }));

      setReports(formattedReports);
    } catch (error) {
      console.error("Load reports error:", error);
      setMessage(
        "Unable to load reports. Please check the backend server."
      );
    } finally {
      setLoadingReports(false);
    }
  }

  useEffect(() => {
    if (active === "Citizen Reports") {
      loadReports();
    }
  }, [active]);

  function handlePhotoChange(event) {
    const selectedPhoto = event.target.files?.[0] || null;

    if (photoPreview) {
      URL.revokeObjectURL(photoPreview);
    }

    setPhoto(selectedPhoto);
    setPhotoPreview(
      selectedPhoto ? URL.createObjectURL(selectedPhoto) : ""
    );
    setMessage("");
  }

  async function submitReport(event) {
    event.preventDefault();

    if (!location.trim()) {
      setMessage("Please enter the road location.");
      return;
    }

    if (!photo) {
      setMessage("Please upload a road photo.");
      return;
    }

    const formData = new FormData();
    formData.append("reportType", reportType);
    formData.append("location", location.trim());
    formData.append("description", description.trim());
    formData.append("photo", photo);

    setLoading(true);
    setMessage("Submitting your road report...");

    try {
      const response = await fetch(`${API_BASE}/api/reports`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Report submission failed.");
      }

      setMessage("Road report successfully saved to database!");
      setReportType("Pothole");
      setLocation("");
      setDescription("");
      setPhoto(null);

      if (photoPreview) {
        URL.revokeObjectURL(photoPreview);
      }

      setPhotoPreview("");
      event.target.reset();

      await loadReports();
    } catch (error) {
      console.error("Submit report error:", error);
      setMessage(error.message || "Unable to submit report.");
    } finally {
      setLoading(false);
    }
  }

  function getGPSLocation() {
    if (!navigator.geolocation) {
      setMessage("GPS is not supported by this browser.");
      return;
    }

    setMessage("Getting your GPS location...");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation(
          `${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)}`
        );
        setMessage("GPS location captured successfully.");
      },
      () => {
        setMessage(
          "GPS unavailable. Please enter location manually."
        );
      }
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">R</div>
          <div>
            <h2>
              RoadSentinel<span> AI</span>
            </h2>
            <small>INTELLIGENT ROAD SYSTEM</small>
          </div>
        </div>

        <div className="menu-label">MAIN MENU</div>

        {navigation.map(([name, icon]) => (
          <button
            key={name}
            className={`nav-item ${active === name ? "active" : ""}`}
            onClick={() => setActive(name)}
          >
            <span>{icon}</span>
            {name}
          </button>
        ))}

        <div className="sidebar-bottom">
          <div className="system-status">
            <span className="status-dot"></span>
            System Interface Online
            <small>Backend API · SQLite Database</small>
          </div>

          <p>ROAD SENTINEL AI · 2026</p>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <span className="breadcrumb">Workspace / </span>
            <strong>{active}</strong>
          </div>

          <div className="top-actions">
            <span className="region">⌖ Maharashtra, India</span>
            <button className="notification">♧</button>
            <div className="avatar">RS</div>
          </div>
        </header>

        <section className="content">
          <div className="welcome">
            <div>
              <span className="eyebrow">
                ROAD INTELLIGENCE PLATFORM
              </span>

              <h1>
                {active === "Overview"
                  ? "Road Intelligence Overview"
                  : active}
              </h1>

              <p>
                Monitor road health. Predict failures. Make smarter
                repair decisions.
              </p>
            </div>

            <button
              className="primary-btn"
              onClick={() => setActive("AI Road Scanner")}
            >
              + New Road Scan
            </button>
          </div>

          {active === "Overview" ? (
            <>
              <div className="stats-grid">
                {stats.map((stat) => (
                  <div className="stat-card" key={stat.title}>
                    <div className="stat-top">
                      <span>{stat.title}</span>
                      <span className="stat-icon">{stat.icon}</span>
                    </div>

                    <h2>{stat.value}</h2>
                    <small>{stat.change}</small>
                  </div>
                ))}
              </div>

              <div className="section-heading">
                <div>
                  <h2>Road Risk Intelligence</h2>
                  <p>Illustrative regional monitoring overview</p>
                </div>

                <span className="demo-tag">DEMO DATA</span>
              </div>

              <div className="dashboard-grid">
                <div className="panel map-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Regional Risk Overview</h3>
                      <p>Maharashtra road monitoring map</p>
                    </div>

                    <span className="live-tag">● PREVIEW</span>
                  </div>

                  <MapView />

                  <div className="legend">
                    <span><i className="red"></i> Critical</span>
                    <span><i className="orange"></i> High</span>
                    <span><i className="yellow"></i> Medium</span>
                    <span><i className="green"></i> Low</span>
                  </div>
                </div>

                <div className="panel priority-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Priority Attention</h3>
                      <p>Illustrative road records</p>
                    </div>

                    <span className="arrow">↗</span>
                  </div>

                  {[
                    ["Pune – Nagar Road", "CRITICAL", "92"],
                    ["Mumbai – Nashik Road", "HIGH", "84"],
                    ["Nashik – Highway Link", "HIGH", "79"],
                    ["Nagpur – Wardha Road", "MEDIUM", "61"],
                  ].map(([road, risk, score]) => (
                    <div className="priority-row" key={road}>
                      <div>
                        <strong>{road}</strong>
                        <small>Risk score: {score}/100</small>
                      </div>

                      <span className={`risk ${risk.toLowerCase()}`}>
                        {risk}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="panel bottom-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Platform Capabilities</h3>
                    <p>Road monitoring workflow</p>
                  </div>
                </div>

                <div className="capabilities">
                  <div>
                    ◎
                    <strong>Detect</strong>
                    <small>Identify road damage</small>
                  </div>

                  <div>
                    ↗
                    <strong>Predict</strong>
                    <small>Estimate future failure</small>
                  </div>

                  <div>
                    ⬡
                    <strong>Analyze</strong>
                    <small>Understand safety risks</small>
                  </div>

                  <div>
                    ✓
                    <strong>Prioritize</strong>
                    <small>Recommend repairs</small>
                  </div>
                </div>
              </div>
            </>
         ) : active === "AI Road Scanner" ? (
  <RoadScanner />
) : active === "Live Risk Map" ? (
  <MapView />
) : active === "Road Intelligence" ? (
  <RoadIntelligence />
) : active === "Failure Prediction" ? (
  <FailurePrediction />
) : active === "Safety Intelligence" ? (
  <SafetyIntelligence />
) : active === "Citizen Reports" ? (
            <div className="citizen-page">
              <div className="panel citizen-form">
                <div className="panel-heading">
                  <div>
                    <h3>Report a Road Problem</h3>
                    <p>Help identify damaged roads in your area.</p>
                  </div>

                  <span className="live-tag">CITIZEN PORTAL</span>
                </div>

                <form onSubmit={submitReport}>
                  <label>Road Problem Type</label>

                  <select
                    value={reportType}
                    onChange={(event) =>
                      setReportType(event.target.value)
                    }
                  >
                    <option>Pothole</option>
                    <option>Road Crack</option>
                    <option>Waterlogging</option>
                    <option>Damaged Road</option>
                    <option>Open Manhole</option>
                  </select>

                  <label>Road Location</label>

                  <input
                    type="text"
                    placeholder="Enter road name, area or city"
                    value={location}
                    onChange={(event) =>
                      setLocation(event.target.value)
                    }
                  />

                  <button
                    type="button"
                    className="location-btn"
                    onClick={getGPSLocation}
                  >
                    ⌖ Use My Current GPS Location
                  </button>

                  <label>Upload Road Photo</label>

                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    capture="environment"
                    onChange={handlePhotoChange}
                  />

                  {photoPreview && (
                    <div className="selected-photo">
                      <img src={photoPreview} alt="Selected road" />
                      <span>{photo?.name}</span>
                    </div>
                  )}

                  <label>Description (Optional)</label>

                  <textarea
                    placeholder="Describe the road problem..."
                    value={description}
                    onChange={(event) =>
                      setDescription(event.target.value)
                    }
                  />

                  <button
                    type="submit"
                    className="primary-btn"
                    disabled={loading}
                  >
                    {loading
                      ? "Submitting..."
                      : "Submit Road Report →"}
                  </button>

                  {message && (
                    <p className="report-message">{message}</p>
                  )}
                </form>
              </div>

              <div className="panel citizen-list">
                <div className="panel-heading">
                  <div>
                    <h3>Submitted Reports</h3>
                    <p>Reports retrieved from the database</p>
                  </div>

                  <span className="demo-tag">
                    {reports.length} REPORTS
                  </span>
                </div>

                {loadingReports ? (
                  <div className="empty-reports">
                    <span>◌</span>
                    <h3>Loading Reports...</h3>
                    <p>Connecting to RoadSentinel database.</p>
                  </div>
                ) : reports.length === 0 ? (
                  <div className="empty-reports">
                    <span>♧</span>
                    <h3>No Reports Yet</h3>
                    <p>Submit your first road damage report.</p>
                  </div>
                ) : (
                  reports.map((report) => (
                    <div className="report-row" key={report.id}>
                      {report.photo && (
                        <img src={report.photo} alt="Road damage" />
                      )}

                      <div className="report-details">
                        <strong>{report.reportType}</strong>
                        <p>⌖ {report.location}</p>

                        <small>
                          {report.description ||
                            "No additional description"}
                        </small>

                        <span className="report-status">
                          ● {report.status}
                        </span>

                        <small>Report ID: #{report.id}</small>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="panel feature-placeholder">
              <div className="feature-icon">◈</div>

              <h2>{active}</h2>

              <p>
                This module is part of the RoadSentinel AI
                development roadmap.
              </p>

              <p>
                We will connect its real functionality in
                upcoming development phases.
              </p>

              <button
                className="primary-btn"
                onClick={() => setActive("Overview")}
              >
                Back to Overview
              </button>
            </div>
          )}

          <footer>
            RoadSentinel AI © 2026 · Predictive Road Intelligence
            <span>Built for safer roads.</span>
          </footer>
        </section>
      </main>
    </div>
  );
}

export default App;

