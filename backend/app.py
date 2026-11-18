
import os
import sqlite3
import uuid
import base64
import json
from pathlib import Path
from datetime import datetime, timezone, timedelta

import cv2
import numpy as np
from dotenv import load_dotenv
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename
from ultralytics import YOLO

load_dotenv(Path(__file__).resolve().parent / ".env")


# --------------------------------------------------
# PROJECT PATHS
# --------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
INSTANCE_DIR = BASE_DIR / "instance"
DATABASE = INSTANCE_DIR / "roadsentinel.db"

MODEL_PATH = (
    Path.home()
    / "runs"
    / "roadsentinel_v2"
    / "road_v2_30epochs"
    / "weights"
    / "best.pt"
)

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
INSTANCE_DIR.mkdir(parents=True, exist_ok=True)


# --------------------------------------------------
# FLASK CONFIGURATION
# --------------------------------------------------

app = Flask(__name__)
CORS(app)

app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}

yolo_model = None


# --------------------------------------------------
# DATABASE
# --------------------------------------------------

def get_db():
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database():
    connection = get_db()

    connection.execute("""
        CREATE TABLE IF NOT EXISTS citizen_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            report_type TEXT NOT NULL,
            location TEXT NOT NULL,
            description TEXT,
            photo TEXT,
            status TEXT DEFAULT 'Received',
            created_at TEXT NOT NULL
        )
    """)

    # Citizen Reports - safe migration for demo department submission.
    existing_report_columns = {
        row[1] for row in connection.execute(
            "PRAGMA table_info(citizen_reports)"
        ).fetchall()
    }

    new_report_columns = {
        "department": "TEXT",
        "demo_submission_id": "TEXT",
        "demo_submission_status": "TEXT",
        "demo_submitted_at": "TEXT",
    }

    for column, column_type in new_report_columns.items():
        if column not in existing_report_columns:
            connection.execute(
                f"ALTER TABLE citizen_reports ADD COLUMN {column} {column_type}"
            )

    connection.execute("""
        CREATE TABLE IF NOT EXISTS ai_scan_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            latitude REAL,
            longitude REAL,
            location_label TEXT,
            damage_type TEXT NOT NULL,
            confidence REAL NOT NULL,
            severity TEXT NOT NULL,
            original_image TEXT,
            annotated_image TEXT,
            box_x1 REAL,
            box_y1 REAL,
            box_x2 REAL,
            box_y2 REAL,
            scanned_at TEXT NOT NULL
        )
    """)

    connection.execute("""
        CREATE TABLE IF NOT EXISTS satellite_analyses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bbox_west REAL NOT NULL,
            bbox_south REAL NOT NULL,
            bbox_east REAL NOT NULL,
            bbox_north REAL NOT NULL,
            location_label TEXT,
            scene_date TEXT,
            scene_id TEXT,
            cloud_cover REAL,
            resolution_m INTEGER,
            image_size_w INTEGER,
            image_size_h INTEGER,
            waterlogging_pct REAL,
            dark_surface_pct REAL,
            ndwi_mean REAL,
            ndwi_water_pct REAL,
            mndwi_water_pct REAL,
            brightness_std REAL,
            surface_change_pct REAL,
            before_date TEXT,
            risk_level TEXT,
            risk_score INTEGER,
            findings TEXT,
            image_rgb_b64 TEXT,
            image_ndwi_b64 TEXT,
            image_before_b64 TEXT,
            image_change_b64 TEXT,
            analyzed_at TEXT NOT NULL
        )
    """)

    # Migrate existing rows that are missing new columns (safe no-op if columns exist)
    existing = {row[1] for row in connection.execute("PRAGMA table_info(satellite_analyses)").fetchall()}
    new_cols = {
        "scene_id": "TEXT", "image_size_w": "INTEGER", "image_size_h": "INTEGER",
        "ndwi_water_pct": "REAL", "mndwi_water_pct": "REAL", "brightness_std": "REAL",
        "surface_change_pct": "REAL", "before_date": "TEXT",
        "image_before_b64": "TEXT", "image_change_b64": "TEXT",
    }
    for col, typ in new_cols.items():
        if col not in existing:
            connection.execute(f"ALTER TABLE satellite_analyses ADD COLUMN {col} {typ}")

    # Road segments — one row per unique road/location
    connection.execute("""
        CREATE TABLE IF NOT EXISTS road_segments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            segment_code TEXT UNIQUE NOT NULL,
            name TEXT,
            location_label TEXT,
            latitude REAL,
            longitude REAL,
            road_type TEXT DEFAULT 'Unknown',
            created_at TEXT NOT NULL
        )
    """)

    # Damage observations — each YOLO scan or citizen report linked to a segment
    connection.execute("""
        CREATE TABLE IF NOT EXISTS damage_observations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            segment_id INTEGER,
            source TEXT NOT NULL,
            damage_type TEXT NOT NULL,
            severity TEXT NOT NULL,
            confidence REAL,
            damaged_area_pct REAL,
            detection_count INTEGER DEFAULT 1,
            original_image TEXT,
            annotated_image TEXT,
            latitude REAL,
            longitude REAL,
            observed_at TEXT NOT NULL,
            FOREIGN KEY(segment_id) REFERENCES road_segments(id)
        )
    """)

    # Road health scores — one per segment per calculation
    connection.execute("""
        CREATE TABLE IF NOT EXISTS road_health_scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            segment_id INTEGER NOT NULL,
            health_score REAL NOT NULL,
            health_category TEXT NOT NULL,
            surface_score REAL,
            severity_score REAL,
            crack_score REAL,
            drainage_score REAL,
            repair_history_score REAL,
            inputs_json TEXT,
            calculated_at TEXT NOT NULL,
            FOREIGN KEY(segment_id) REFERENCES road_segments(id)
        )
    """)

    # Failure predictions
    connection.execute("""
        CREATE TABLE IF NOT EXISTS failure_predictions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            segment_id INTEGER NOT NULL,
            model_type TEXT NOT NULL,
            observation_count INTEGER NOT NULL,
            deterioration_rate REAL,
            trend TEXT,
            predicted_health_30d REAL,
            predicted_health_90d REAL,
            failure_risk_level TEXT,
            confidence_note TEXT,
            sufficient_data INTEGER DEFAULT 0,
            inputs_json TEXT,
            predicted_at TEXT NOT NULL,
            FOREIGN KEY(segment_id) REFERENCES road_segments(id)
        )
    """)

    # Cause analysis
    connection.execute("""
        CREATE TABLE IF NOT EXISTS cause_analyses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            segment_id INTEGER NOT NULL,
            factors_json TEXT,
            recommendations_json TEXT,
            evidence_summary TEXT,
            analyzed_at TEXT NOT NULL,
            FOREIGN KEY(segment_id) REFERENCES road_segments(id)
        )
    """)

    # Safety assessments
    connection.execute("""
        CREATE TABLE IF NOT EXISTS safety_assessments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            segment_id INTEGER NOT NULL,
            safety_score REAL NOT NULL,
            risk_category TEXT NOT NULL,
            damage_severity TEXT,
            traffic_density TEXT DEFAULT 'Unknown',
            vehicle_speed TEXT DEFAULT 'Unknown',
            road_type TEXT DEFAULT 'Unknown',
            sensitive_location TEXT,
            inputs_json TEXT,
            assessed_at TEXT NOT NULL,
            FOREIGN KEY(segment_id) REFERENCES road_segments(id)
        )
    """)

    # Repair priority
    connection.execute("""
        CREATE TABLE IF NOT EXISTS repair_priorities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            segment_id INTEGER NOT NULL,
            priority_score REAL NOT NULL,
            priority_level TEXT NOT NULL,
            recommended_action TEXT,
            urgency TEXT,
            score_breakdown_json TEXT,
            calculated_at TEXT NOT NULL,
            FOREIGN KEY(segment_id) REFERENCES road_segments(id)
        )
    """)

    connection.commit()
    connection.close()


# --------------------------------------------------
# FILE VALIDATION
# --------------------------------------------------

def allowed_file(filename):
    return (
        "." in filename
        and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS
    )


def is_road_image(image_bgr):
    """
    Heuristic: road images have large grey/asphalt regions and low saturation.
    Returns (bool, reason_string).
    """
    h, w = image_bgr.shape[:2]
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    hue = hsv[:, :, 0]
    sat = hsv[:, :, 1].astype(np.float32)
    val = hsv[:, :, 2].astype(np.float32)

    # Skin tone detection: narrow hue range (0-18), high saturation, no dark pixels
    # Road surfaces (sandy/warm asphalt) have low saturation unlike actual skin
    skin_mask = (
        (hue >= 0) & (hue <= 18) &
        (sat >= 80) & (sat <= 200) &
        (val >= 80) & (val <= 230)
    )
    skin_pct = float(np.mean(skin_mask) * 100)

    # Also require face-like uniformity: skin pixels must be clustered (>12% AND low grey content)
    low_sat_pct = float(np.mean(sat < 30) * 100)
    if skin_pct > 30 and low_sat_pct < 20:
        return False, "This appears to be a photo of a person, not a road surface. Please upload a road image."

    # Check lower half for asphalt-like pixels (low sat, moderate brightness)
    lower = hsv[h // 2:, :]
    lower_sat = lower[:, :, 1].astype(np.float32)
    lower_val = lower[:, :, 2].astype(np.float32)
    asphalt_pct = float(np.mean((lower_sat < 60) & (lower_val > 15) & (lower_val < 220)) * 100)

    if asphalt_pct < 5 and float(np.mean(lower_sat < 70) * 100) < 10:
        return False, "No road surface detected. Please upload a ground-level road photo."

    return True, "ok"


# --------------------------------------------------
# YOLO MODEL
# --------------------------------------------------

def get_yolo_model():
    global yolo_model

    if yolo_model is None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(
                f"YOLO model not found: {MODEL_PATH}"
            )

        app.logger.info("Loading RoadSentinel YOLO model...")

        yolo_model = YOLO(str(MODEL_PATH))

        app.logger.info(
            "YOLO model loaded: %s",
            yolo_model.names
        )

    return yolo_model


# --------------------------------------------------
# DAMAGE SEVERITY
# --------------------------------------------------

def get_damage_severity(class_name):

    severity_map = {
        "pothole": "High",
        "longitudinal_crack": "Medium",
        "transverse_crack": "Medium",
        "alligator_crack": "High",
        "waterlogging": "High",
        "repaired_patch": "Low",
        "road_edge_damage": "High"
    }

    return severity_map.get(class_name, "Unknown")


# --------------------------------------------------
# HEALTH API
# --------------------------------------------------

@app.route("/api/health", methods=["GET"])
def health():

    return jsonify({
        "status": "healthy",
        "project": "RoadSentinel AI",
        "service": "Backend API"
    })


# --------------------------------------------------
# AI ROAD SCANNER API
# --------------------------------------------------

@app.route("/api/scan", methods=["POST"])
def scan_road():

    photo = request.files.get("photo")

    if not photo or not photo.filename:
        return jsonify({
            "success": False,
            "message": "Please upload a road image."
        }), 400

    if not allowed_file(photo.filename):
        return jsonify({
            "success": False,
            "message": "Only JPG, JPEG, PNG and WEBP images are allowed."
        }), 400

    extension = secure_filename(photo.filename).rsplit(".", 1)[1].lower()

    image_name = f"{uuid.uuid4().hex}.{extension}"
    image_path = UPLOAD_DIR / image_name

    output_path = None

    try:

        # Save uploaded image
        photo.save(image_path)

        # Validate image
        image = cv2.imread(str(image_path))

        if image is None:
            image_path.unlink(missing_ok=True)
            return jsonify({
                "success": False,
                "message": "Invalid or unreadable image."
            }), 400

        # Validate that the image is a road photo
        is_road, reason = is_road_image(image)
        if not is_road:
            image_path.unlink(missing_ok=True)
            return jsonify({
                "success": False,
                "message": reason
            }), 400

        # Load trained YOLO model
        model = get_yolo_model()

        h_orig, w_orig = image.shape[:2]

        # Resize large images so YOLO can see the full frame clearly
        max_side = 1280
        scale = min(max_side / w_orig, max_side / h_orig, 1.0)
        if scale < 1.0:
            proc = cv2.resize(image, (int(w_orig * scale), int(h_orig * scale)), interpolation=cv2.INTER_AREA)
        else:
            proc = image.copy()
            scale = 1.0

        ph, pw = proc.shape[:2]

        def run_predict(src):
            return model.predict(
                source=src,
                conf=0.04,
                iou=0.6,
                agnostic_nms=False,
                device="cpu",
                verbose=False
            )[0]

        # Full-image pass
        result_full = run_predict(proc)
        raw_boxes = []
        if result_full.boxes is not None:
            for box in result_full.boxes:
                raw_boxes.append((
                    int(box.cls.item()),
                    float(box.conf.item()),
                    [v / scale for v in box.xyxy[0].tolist()]
                ))

        # Tiled pass — split into 2×2 tiles to catch small damages
        tile_h, tile_w = ph // 2, pw // 2
        for row in range(2):
            for col in range(2):
                y1, x1 = row * tile_h, col * tile_w
                y2, x2 = min(y1 + tile_h, ph), min(x1 + tile_w, pw)
                tile = proc[y1:y2, x1:x2]
                if tile.size == 0:
                    continue
                res_tile = run_predict(tile)
                if res_tile.boxes is not None:
                    for box in res_tile.boxes:
                        bx1, by1, bx2, by2 = box.xyxy[0].tolist()
                        # Map tile coords back to original image coords
                        raw_boxes.append((
                            int(box.cls.item()),
                            float(box.conf.item()),
                            [
                                (bx1 + x1) / scale,
                                (by1 + y1) / scale,
                                (bx2 + x1) / scale,
                                (by2 + y1) / scale,
                            ]
                        ))

        # Per-class NMS to remove duplicates across full + tile passes
        def iou_val(a, b):
            ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
            ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
            inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
            if inter == 0:
                return 0.0
            area_a = (a[2]-a[0]) * (a[3]-a[1])
            area_b = (b[2]-b[0]) * (b[3]-b[1])
            return inter / (area_a + area_b - inter)

        # Group by class, apply NMS per class
        from collections import defaultdict
        by_class = defaultdict(list)
        for cls_id, conf, coords in raw_boxes:
            by_class[cls_id].append((conf, coords))

        kept = []
        for cls_id, items in by_class.items():
            items.sort(key=lambda x: x[0], reverse=True)
            accepted = []
            for conf, coords in items:
                if all(iou_val(coords, ac[1]) < 0.5 for ac in accepted):
                    accepted.append((conf, coords))
            for conf, coords in accepted:
                kept.append((cls_id, conf, coords))

        detections = []
        for cls_id, conf, coords in kept:
            class_name = model.names[cls_id]
            detections.append({
                "classId": cls_id,
                "damage": class_name,
                "confidence": round(conf * 100, 2),
                "severity": get_damage_severity(class_name),
                "box": [round(v, 2) for v in coords]
            })

        # Draw detections on original image
        annotated_image = image.copy()
        for det in detections:
            x1, y1, x2, y2 = [int(v) for v in det["box"]]
            color = {"High": (0, 0, 255), "Medium": (0, 165, 255), "Low": (0, 255, 0)}.get(det["severity"], (255, 255, 0))
            cv2.rectangle(annotated_image, (x1, y1), (x2, y2), color, 2)
            label = f"{det['damage']} {det['confidence']:.1f}%"
            cv2.putText(annotated_image, label, (x1, max(y1 - 6, 10)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)

        output_name = f"annotated_{uuid.uuid4().hex}.jpg"

        output_path = UPLOAD_DIR / output_name

        saved = cv2.imwrite(
            str(output_path),
            annotated_image
        )

        if not saved:
            raise RuntimeError("Could not save annotated image.")

        # Calculate overall severity
        severity_order = {
            "Low": 1,
            "Medium": 2,
            "High": 3
        }

        if detections:

            overall_severity = max(
                (item["severity"] for item in detections),
                key=lambda value: severity_order.get(value, 0)
            )

        else:
            overall_severity = "No damage detected"

        # Persist detections to database
        scanned_at = datetime.now(timezone.utc).isoformat()

        lat = request.form.get("latitude", type=float)
        lng = request.form.get("longitude", type=float)
        location_label = request.form.get("locationLabel", "")

        scan_ids = []

        if detections:
            for det in detections:
                box = det["box"]
                cursor = connection_scan = get_db()
                cur = connection_scan.execute("""
                    INSERT INTO ai_scan_results
                    (latitude, longitude, location_label, damage_type, confidence,
                     severity, original_image, annotated_image,
                     box_x1, box_y1, box_x2, box_y2, scanned_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    lat, lng, location_label,
                    det["damage"], det["confidence"], det["severity"],
                    image_name, output_name,
                    box[0], box[1], box[2], box[3],
                    scanned_at
                ))
                scan_ids.append(cur.lastrowid)
                connection_scan.commit()
                connection_scan.close()

        return jsonify({
            "success": True,
            "message": "Road image analyzed successfully.",
            "count": len(detections),
            "severity": overall_severity,
            "detections": detections,
            "originalImage": f"/uploads/{image_name}",
            "annotatedImage": f"/uploads/{output_name}"
        }), 200

    except Exception:

        app.logger.exception("Road scan failed")

        image_path.unlink(missing_ok=True)

        if output_path:
            output_path.unlink(missing_ok=True)

        return jsonify({
            "success": False,
            "message": "AI scanning failed. Please check backend logs."
        }), 500


# --------------------------------------------------
# CITIZEN REPORTS - CREATE (DEMO SUBMISSION ONLY)
# --------------------------------------------------

@app.route("/api/reports", methods=["POST"])
def create_report():

    report_type = (
        request.form.get("reportType")
        or request.form.get("type")
    )

    location = request.form.get("location")
    description = request.form.get("description", "")

    department = request.form.get(
        "department", "Municipal Corporation"
    ).strip()

    allowed_departments = [
        "Municipal Corporation",
        "PWD"
    ]

    if not report_type or not location:
        return jsonify({
            "success": False,
            "message": "Report type and location are required."
        }), 400

    if department not in allowed_departments:
        return jsonify({
            "success": False,
            "message": "Invalid department selected."
        }), 400

    photo_name = None
    photo = request.files.get("photo")

    if photo and photo.filename:

        if not allowed_file(photo.filename):
            return jsonify({
                "success": False,
                "message": "Only JPG, JPEG, PNG and WEBP images are allowed."
            }), 400

        safe_filename = secure_filename(photo.filename)

        if "." not in safe_filename:
            return jsonify({
                "success": False,
                "message": "Invalid image filename."
            }), 400

        extension = safe_filename.rsplit(".", 1)[1].lower()
        photo_name = f"{uuid.uuid4().hex}.{extension}"
        photo.save(UPLOAD_DIR / photo_name)

    created_at = datetime.now(timezone.utc).isoformat()
    demo_submitted_at = datetime.now(timezone.utc).isoformat()

    connection = get_db()

    try:
        cursor = connection.execute("""
            INSERT INTO citizen_reports (
                report_type,
                location,
                description,
                photo,
                status,
                created_at,
                department,
                demo_submission_status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            report_type,
            location,
            description,
            photo_name,
            "Received",
            created_at,
            department,
            "SIMULATION_ONLY_NOT_SENT"
        ))

        report_id = cursor.lastrowid
        demo_submission_id = (
            f"DEMO-{datetime.now().strftime('%Y%m%d')}-{report_id:05d}"
        )

        connection.execute("""
            UPDATE citizen_reports
            SET demo_submission_id = ?,
                demo_submitted_at = ?
            WHERE id = ?
        """, (
            demo_submission_id,
            demo_submitted_at,
            report_id
        ))

        connection.commit()

    except Exception:
        connection.rollback()
        if photo_name:
            try:
                (UPLOAD_DIR / photo_name).unlink(missing_ok=True)
            except OSError:
                pass
        raise

    finally:
        connection.close()

    return jsonify({
        "success": True,
        "message": "Demo report recorded locally. Not sent to government.",
        "report": {
            "id": report_id,
            "reportType": report_type,
            "location": location,
            "description": description,
            "photo": f"/uploads/{photo_name}" if photo_name else None,
            "status": "Received",
            "department": department,
            "demoSubmissionId": demo_submission_id,
            "demoSubmissionStatus": "SIMULATION_ONLY_NOT_SENT",
            "demoSubmittedAt": demo_submitted_at,
            "createdAt": created_at
        },
        "simulationOnly": True,
        "notice": "This is a demonstration only. No report is sent to any government department."
    }), 201


# --------------------------------------------------
# CITIZEN REPORTS - GET
# --------------------------------------------------

@app.route("/api/reports", methods=["GET"])
def get_reports():

    connection = get_db()

    try:
        rows = connection.execute("""
            SELECT *
            FROM citizen_reports
            ORDER BY id DESC
        """).fetchall()

        reports = []

        for row in rows:
            reports.append({
                "id": row["id"],
                "reportType": row["report_type"],
                "location": row["location"],
                "description": row["description"],
                "photo": (
                    f"/uploads/{row['photo']}"
                    if row["photo"] else None
                ),
                "status": row["status"],
                "department": row["department"],
                "demoSubmissionId": row["demo_submission_id"],
                "demoSubmissionStatus": row["demo_submission_status"],
                "demoSubmittedAt": row["demo_submitted_at"],
                "createdAt": row["created_at"]
            })

    finally:
        connection.close()

    return jsonify({
        "success": True,
        "count": len(reports),
        "reports": reports,
        "simulationOnly": True,
        "notice": "Simulation only. No report is sent to any government department."
    }), 200


# --------------------------------------------------
# MAP DATA API
# --------------------------------------------------

@app.route("/api/map/data", methods=["GET"])
def get_map_data():

    connection = get_db()

    report_rows = connection.execute("""
        SELECT * FROM citizen_reports ORDER BY id DESC
    """).fetchall()

    scan_rows = connection.execute("""
        SELECT * FROM ai_scan_results ORDER BY id DESC
    """).fetchall()

    connection.close()

    # Parse GPS from citizen report location field ("lat, lng" format)
    def parse_gps(location_str):
        try:
            parts = location_str.split(",")
            if len(parts) == 2:
                lat = float(parts[0].strip())
                lng = float(parts[1].strip())
                if -90 <= lat <= 90 and -180 <= lng <= 180:
                    return lat, lng
        except (ValueError, AttributeError):
            pass
        return None, None

    def risk_score(severity, confidence=None):
        base = {"High": 75, "Medium": 50, "Low": 25}.get(severity, 40)
        if confidence:
            base = int(base * 0.6 + (confidence / 100) * base * 0.4)
        return min(base, 100)

    def risk_level(score):
        if score >= 75:
            return "CRITICAL"
        if score >= 55:
            return "HIGH"
        if score >= 35:
            return "MEDIUM"
        return "LOW"

    citizen_markers = []
    for row in report_rows:
        lat, lng = parse_gps(row["location"])
        score = risk_score("High" if "pothole" in row["report_type"].lower() else "Medium")
        citizen_markers.append({
            "id": f"cr_{row['id']}",
            "source": "citizen",
            "reportType": row["report_type"],
            "location": row["location"],
            "latitude": lat,
            "longitude": lng,
            "hasGPS": lat is not None,
            "description": row["description"] or "",
            "photo": f"/uploads/{row['photo']}" if row["photo"] else None,
            "status": row["status"],
            "severity": "High" if "pothole" in row["report_type"].lower() else "Medium",
            "riskScore": score,
            "riskLevel": risk_level(score),
            "createdAt": row["created_at"]
        })

    ai_markers = []
    for row in scan_rows:
        score = risk_score(row["severity"], row["confidence"])
        ai_markers.append({
            "id": f"ai_{row['id']}",
            "source": "ai",
            "damageType": row["damage_type"],
            "locationLabel": row["location_label"] or "Unknown",
            "latitude": row["latitude"],
            "longitude": row["longitude"],
            "hasGPS": row["latitude"] is not None,
            "confidence": row["confidence"],
            "severity": row["severity"],
            "riskScore": score,
            "riskLevel": risk_level(score),
            "originalImage": f"/uploads/{row['original_image']}" if row["original_image"] else None,
            "annotatedImage": f"/uploads/{row['annotated_image']}" if row["annotated_image"] else None,
            "scannedAt": row["scanned_at"]
        })

    # Damage breakdown across both sources
    damage_counts = {}
    for m in ai_markers:
        d = m["damageType"]
        damage_counts[d] = damage_counts.get(d, 0) + 1
    for m in citizen_markers:
        d = m["reportType"]
        damage_counts[d] = damage_counts.get(d, 0) + 1

    all_markers = citizen_markers + ai_markers
    critical_count = sum(1 for m in all_markers if m["riskLevel"] == "CRITICAL")
    high_count = sum(1 for m in all_markers if m["riskLevel"] == "HIGH")
    pending = sum(1 for m in citizen_markers if m["status"] == "Received")
    resolved = sum(1 for m in citizen_markers if m["status"] == "Resolved")

    return jsonify({
        "success": True,
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
        "stats": {
            "totalReports": len(citizen_markers),
            "totalAIDetections": len(ai_markers),
            "criticalLocations": critical_count,
            "highRiskLocations": high_count,
            "pendingReports": pending,
            "resolvedReports": resolved,
            "damageBreakdown": damage_counts
        },
        "citizenReports": citizen_markers,
        "aiDetections": ai_markers
    })


# --------------------------------------------------
# SATELLITE HELPERS
# --------------------------------------------------

def get_sh_config():
    """Return SHConfig if credentials are set, else None."""
    client_id = os.environ.get("SH_CLIENT_ID", "").strip()
    client_secret = os.environ.get("SH_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        return None
    try:
        from sentinelhub import SHConfig
        cfg = SHConfig()
        cfg.sh_client_id = client_id
        cfg.sh_client_secret = client_secret
        return cfg
    except Exception:
        return None


def analyze_satellite_image(img_rgb):
    """
    Run spectral analysis on a Sentinel-2 RGB image (numpy HxWx3, uint8).
    Returns dict of findings. Uses only real pixel values — no fabrication.
    NOTE: Sentinel-2 10m resolution cannot detect individual potholes/cracks.
    It CAN detect large-scale waterlogging, surface darkening, and area changes.
    """
    if img_rgb is None or img_rgb.size == 0:
        return None

    h, w = img_rgb.shape[:2]
    total_px = h * w

    r = img_rgb[:, :, 0].astype(np.float32)
    g = img_rgb[:, :, 1].astype(np.float32)
    b = img_rgb[:, :, 2].astype(np.float32)

    # NDWI proxy using RGB: (G - R) / (G + R)
    denom = g + r
    ndwi = np.where(denom > 0, (g - r) / denom, 0.0)
    ndwi_mean = float(np.mean(ndwi))
    waterlogging_pct = float(np.mean(ndwi > 0.15) * 100)

    # Dark surface proxy (road damage / bare soil indicator)
    gray = (0.299 * r + 0.587 * g + 0.114 * b)
    dark_surface_pct = float(np.mean(gray < 60) * 100)

    # Brightness variance (surface heterogeneity)
    brightness_std = float(np.std(gray))

    findings = []
    risk_score = 10

    if waterlogging_pct > 15:
        findings.append({
            "type": "waterlogging",
            "label": "Waterlogging / Standing Water",
            "coverage_pct": round(waterlogging_pct, 1),
            "confidence": "Medium",
            "note": "Detected via NDWI proxy on RGB bands. Verify on ground."
        })
        risk_score += 40
    elif waterlogging_pct > 5:
        findings.append({
            "type": "moisture",
            "label": "Surface Moisture",
            "coverage_pct": round(waterlogging_pct, 1),
            "confidence": "Low",
            "note": "Possible moisture. Low confidence from RGB alone."
        })
        risk_score += 15

    if dark_surface_pct > 30:
        findings.append({
            "type": "dark_surface",
            "label": "Dark Surface Area",
            "coverage_pct": round(dark_surface_pct, 1),
            "confidence": "Low",
            "note": "Dark pixels may indicate road surface, shadow, or damage. Cannot distinguish at satellite resolution."
        })
        risk_score += 20

    if brightness_std > 40:
        findings.append({
            "type": "heterogeneity",
            "label": "High Surface Heterogeneity",
            "value": round(brightness_std, 1),
            "confidence": "Low",
            "note": "High variance may indicate mixed land cover or surface disturbance."
        })
        risk_score += 10

    if not findings:
        findings.append({
            "type": "no_anomaly",
            "label": "No Significant Anomaly Detected",
            "confidence": "Medium",
            "note": "No waterlogging or major surface anomaly detected at satellite resolution."
        })

    risk_score = min(risk_score, 100)
    if risk_score >= 65:
        risk_level = "HIGH"
    elif risk_score >= 40:
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"

    return {
        "waterlogging_pct": round(waterlogging_pct, 2),
        "dark_surface_pct": round(dark_surface_pct, 2),
        "ndwi_mean": round(ndwi_mean, 4),
        "brightness_std": round(brightness_std, 2),
        "risk_score": risk_score,
        "risk_level": risk_level,
        "findings": findings,
    }


def encode_image_b64(img_bgr):
    """Encode a numpy BGR image to base64 JPEG string."""
    try:
        _, buf = cv2.imencode(".jpg", img_bgr, [cv2.IMWRITE_JPEG_QUALITY, 85])
        return base64.b64encode(buf).decode("utf-8")
    except Exception:
        return None


def make_ndwi_visual(img_rgb):
    """Create a false-colour NDWI visualisation image (blue=water, grey=land)."""
    r = img_rgb[:, :, 0].astype(np.float32)
    g = img_rgb[:, :, 1].astype(np.float32)
    denom = g + r
    ndwi = np.where(denom > 0, (g - r) / denom, 0.0)
    vis = np.zeros((*img_rgb.shape[:2], 3), dtype=np.uint8)
    water_mask = ndwi > 0.15
    vis[water_mask] = [200, 100, 30]    # blue-ish in BGR
    vis[~water_mask] = [80, 80, 80]     # grey land
    # Overlay brightness from original
    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
    vis[:, :, 1] = np.clip(vis[:, :, 1].astype(int) + gray // 4, 0, 255).astype(np.uint8)
    return vis


# --------------------------------------------------
# SATELLITE STATUS API
# --------------------------------------------------

@app.route("/api/satellite/status", methods=["GET"])
def satellite_status():
    cfg = get_sh_config()
    configured = cfg is not None
    conn = get_db()
    count = conn.execute("SELECT COUNT(*) FROM satellite_analyses").fetchone()[0]
    conn.close()
    return jsonify({
        "configured": configured,
        "provider": "Sentinel Hub (Copernicus / ESA)",
        "dataSource": "Sentinel-2 L2A",
        "resolution": "10m RGB, 20m SWIR, 60m scene",
        "limitation": "Cannot detect individual potholes or cracks. Detects waterlogging, large surface changes, vegetation loss.",
        "totalAnalyses": count,
        "credentialsNote": "Set SH_CLIENT_ID and SH_CLIENT_SECRET in backend/.env"
    })


# --------------------------------------------------
# SATELLITE SCENE SEARCH API
# --------------------------------------------------

@app.route("/api/satellite/scenes", methods=["GET"])
def satellite_scenes():
    """
    Search available Sentinel-2 scenes for a bounding box.
    Query params: west, south, east, north, days (default 60)
    """
    cfg = get_sh_config()
    if cfg is None:
        return jsonify({
            "success": False,
            "configured": False,
            "message": "Sentinel Hub credentials not configured. Add SH_CLIENT_ID and SH_CLIENT_SECRET to backend/.env"
        }), 200

    try:
        west = float(request.args.get("west", 73.97))
        south = float(request.args.get("south", 18.45))
        east = float(request.args.get("east", 74.07))
        north = float(request.args.get("north", 18.55))
        days = int(request.args.get("days", 60))
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Invalid bbox parameters."}), 400

    try:
        from sentinelhub import SentinelHubCatalog, DataCollection, BBox, CRS

        catalog = SentinelHubCatalog(config=cfg)
        bbox = BBox(bbox=[west, south, east, north], crs=CRS.WGS84)
        end_dt = datetime.now(timezone.utc)
        start_dt = end_dt - timedelta(days=days)
        time_interval = (start_dt.strftime("%Y-%m-%d"), end_dt.strftime("%Y-%m-%d"))

        results = list(catalog.search(
            DataCollection.SENTINEL2_L2A,
            bbox=bbox,
            time=time_interval,
            fields={"include": ["id", "properties.datetime", "properties.eo:cloud_cover"]},
            limit=10,
        ))

        scenes = []
        for item in results:
            props = item.get("properties", {})
            scenes.append({
                "id": item.get("id"),
                "date": props.get("datetime", "")[:10],
                "cloudCover": round(props.get("eo:cloud_cover", 100), 1),
                "dataSource": "Sentinel-2 L2A",
                "resolution": "10m (RGB)",
            })

        scenes.sort(key=lambda s: s["cloudCover"])

        return jsonify({
            "success": True,
            "bbox": {"west": west, "south": south, "east": east, "north": north},
            "searchPeriodDays": days,
            "scenes": scenes,
            "count": len(scenes),
        })

    except Exception as exc:
        app.logger.exception("Satellite scene search failed")
        return jsonify({"success": False, "message": str(exc)}), 500


# --------------------------------------------------
# SATELLITE ANALYZE API
# --------------------------------------------------

@app.route("/api/satellite/analyze", methods=["POST"])
def satellite_analyze():
    """
    Fetch a real Sentinel-2 image for a bbox + date range, run spectral
    analysis, persist result, return findings + base64 images.
    Body JSON: { west, south, east, north, startDate, endDate, locationLabel }
    """
    cfg = get_sh_config()
    if cfg is None:
        return jsonify({
            "success": False,
            "configured": False,
            "message": "Sentinel Hub credentials not configured. Add SH_CLIENT_ID and SH_CLIENT_SECRET to backend/.env"
        }), 200

    body = request.get_json(force=True, silent=True) or {}
    try:
        west = float(body.get("west", 73.97))
        south = float(body.get("south", 18.45))
        east = float(body.get("east", 74.07))
        north = float(body.get("north", 18.55))
        start_date = body.get("startDate") or (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
        end_date = body.get("endDate") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        location_label = body.get("locationLabel", "")
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Invalid request parameters."}), 400

    try:
        from sentinelhub import (
            SentinelHubRequest, DataCollection, MimeType,
            BBox, CRS, bbox_to_dimensions
        )

        bbox = BBox(bbox=[west, south, east, north], crs=CRS.WGS84)
        # Use 60m resolution to stay within free-tier processing units
        size = bbox_to_dimensions(bbox, resolution=60)
        # Cap image size to avoid excessive processing units
        max_dim = 512
        if size[0] > max_dim or size[1] > max_dim:
            scale = max_dim / max(size)
            size = (int(size[0] * scale), int(size[1] * scale))

        evalscript_rgb = """
//VERSION=3
function setup() {
  return { input: ["B04","B03","B02","SCL"], output: { bands: 3, sampleType: "UINT8" } };
}
function evaluatePixel(s) {
  return [Math.round(Math.min(2.5*s.B04,1)*255),
          Math.round(Math.min(2.5*s.B03,1)*255),
          Math.round(Math.min(2.5*s.B02,1)*255)];
}
"""

        req = SentinelHubRequest(
            evalscript=evalscript_rgb,
            input_data=[SentinelHubRequest.input_data(
                data_collection=DataCollection.SENTINEL2_L2A,
                time_interval=(start_date, end_date),
                maxcc=0.4,
            )],
            responses=[SentinelHubRequest.output_response("default", MimeType.PNG)],
            bbox=bbox,
            size=size,
            config=cfg,
        )

        images = req.get_data()
        if not images or images[0] is None:
            return jsonify({"success": False, "message": "No Sentinel-2 imagery available for this area and date range."}), 200

        img_rgb = images[0]  # HxWx3 uint8 RGB

        analysis = analyze_satellite_image(img_rgb)
        if analysis is None:
            return jsonify({"success": False, "message": "Image analysis failed."}), 500

        # Convert RGB -> BGR for OpenCV encoding
        img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
        rgb_b64 = encode_image_b64(img_bgr)
        ndwi_vis = make_ndwi_visual(img_rgb)
        ndwi_b64 = encode_image_b64(ndwi_vis)

        analyzed_at = datetime.now(timezone.utc).isoformat()

        conn = get_db()
        cur = conn.execute("""
            INSERT INTO satellite_analyses
            (bbox_west, bbox_south, bbox_east, bbox_north, location_label,
             scene_date, cloud_cover, resolution_m,
             waterlogging_pct, dark_surface_pct, ndwi_mean,
             risk_level, risk_score, findings,
             image_rgb_b64, image_ndwi_b64, analyzed_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            west, south, east, north, location_label,
            f"{start_date} to {end_date}", None, 60,
            analysis["waterlogging_pct"], analysis["dark_surface_pct"],
            analysis["ndwi_mean"], analysis["risk_level"], analysis["risk_score"],
            json.dumps(analysis["findings"]),
            rgb_b64, ndwi_b64,
            analyzed_at
        ))
        analysis_id = cur.lastrowid
        conn.commit()
        conn.close()

        return jsonify({
            "success": True,
            "id": analysis_id,
            "bbox": {"west": west, "south": south, "east": east, "north": north},
            "locationLabel": location_label,
            "sceneDateRange": f"{start_date} to {end_date}",
            "resolutionM": 60,
            "dataSource": "Sentinel-2 L2A via Sentinel Hub",
            "imageSizePx": list(size),
            "analysis": analysis,
            "imageRgbB64": rgb_b64,
            "imageNdwiB64": ndwi_b64,
            "analyzedAt": analyzed_at,
            "limitation": "Sentinel-2 at 60m resolution detects waterlogging and large surface changes. Individual potholes and cracks require ground-level YOLO detection."
        })

    except Exception as exc:
        app.logger.exception("Satellite analysis failed")
        return jsonify({"success": False, "message": str(exc)}), 500


# --------------------------------------------------
# SATELLITE HISTORY API
# --------------------------------------------------

@app.route("/api/satellite/history", methods=["GET"])
def satellite_history():
    """Return all past satellite analyses from the database."""
    conn = get_db()
    rows = conn.execute("""
        SELECT id, bbox_west, bbox_south, bbox_east, bbox_north,
               location_label, scene_date, resolution_m,
               waterlogging_pct, dark_surface_pct, ndwi_mean,
               risk_level, risk_score, findings, analyzed_at
        FROM satellite_analyses ORDER BY id DESC LIMIT 20
    """).fetchall()
    conn.close()

    analyses = []
    for row in rows:
        try:
            findings = json.loads(row["findings"]) if row["findings"] else []
        except Exception:
            findings = []
        analyses.append({
            "id": row["id"],
            "bbox": {
                "west": row["bbox_west"], "south": row["bbox_south"],
                "east": row["bbox_east"], "north": row["bbox_north"]
            },
            "centerLat": (row["bbox_south"] + row["bbox_north"]) / 2,
            "centerLng": (row["bbox_west"] + row["bbox_east"]) / 2,
            "locationLabel": row["location_label"] or "Unknown",
            "sceneDate": row["scene_date"],
            "resolutionM": row["resolution_m"],
            "waterloggingPct": row["waterlogging_pct"],
            "darkSurfacePct": row["dark_surface_pct"],
            "ndwiMean": row["ndwi_mean"],
            "riskLevel": row["risk_level"],
            "riskScore": row["risk_score"],
            "findings": findings,
            "analyzedAt": row["analyzed_at"],
            "dataSource": "Sentinel-2 L2A",
        })

    return jsonify({"success": True, "analyses": analyses, "count": len(analyses)})


# --------------------------------------------------
# SERVE UPLOADED IMAGES
# --------------------------------------------------

@app.route("/uploads/<filename>", methods=["GET"])
def uploaded_file(filename):

    return send_from_directory(UPLOAD_DIR, filename)


# --------------------------------------------------
# FILE SIZE ERROR
# --------------------------------------------------

@app.errorhandler(413)
def file_too_large(error):

    return jsonify({
        "success": False,
        "message": "Photo size must be less than 10 MB."
    }), 413


# --------------------------------------------------
# INITIALIZE AND RUN
# --------------------------------------------------

initialize_database()


if __name__ == "__main__":

    app.run(
        host="127.0.0.1",
        port=5001,
        debug=True
    )

