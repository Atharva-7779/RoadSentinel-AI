
import os
import sqlite3
import uuid
from pathlib import Path
from datetime import datetime, timezone

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
INSTANCE_DIR = BASE_DIR / "instance"
DATABASE = INSTANCE_DIR / "roadsentinel.db"

UPLOAD_DIR.mkdir(exist_ok=True)
INSTANCE_DIR.mkdir(exist_ok=True)

app = Flask(__name__)
CORS(app)

app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}


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

    connection.commit()
    connection.close()


def allowed_file(filename):
    return (
        "." in filename
        and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS
    )


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "healthy",
        "project": "RoadSentinel AI",
        "service": "Backend API"
    })


@app.route("/api/reports", methods=["POST"])
def create_report():
    report_type = request.form.get("reportType") or request.form.get("type")
    location = request.form.get("location")
    description = request.form.get("description", "")

    if not report_type or not location:
        return jsonify({
            "success": False,
            "message": "Report type and location are required."
        }), 400

    photo_name = None

    photo = request.files.get("photo")

    if photo and photo.filename:
        if not allowed_file(photo.filename):
            return jsonify({
                "success": False,
                "message": "Only JPG, JPEG, PNG and WEBP images are allowed."
            }), 400

        extension = secure_filename(photo.filename).rsplit(".", 1)[1].lower()
        photo_name = f"{uuid.uuid4().hex}.{extension}"

        photo.save(UPLOAD_DIR / photo_name)

    created_at = datetime.now(timezone.utc).isoformat()

    connection = get_db()

    cursor = connection.execute("""
        INSERT INTO citizen_reports
        (report_type, location, description, photo, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (
        report_type,
        location,
        description,
        photo_name,
        "Received",
        created_at
    ))

    report_id = cursor.lastrowid

    connection.commit()
    connection.close()

    return jsonify({
        "success": True,
        "message": "Road report submitted successfully.",
        "report": {
            "id": report_id,
            "reportType": report_type,
            "location": location,
            "description": description,
            "photo": f"/uploads/{photo_name}" if photo_name else None,
            "status": "Received",
            "createdAt": created_at
        }
    }), 201


@app.route("/api/reports", methods=["GET"])
def get_reports():
    connection = get_db()

    rows = connection.execute("""
        SELECT * FROM citizen_reports
        ORDER BY id DESC
    """).fetchall()

    connection.close()

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
            "createdAt": row["created_at"]
        })

    return jsonify({
        "success": True,
        "count": len(reports),
        "reports": reports
    })


@app.route("/uploads/<filename>", methods=["GET"])
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)


@app.errorhandler(413)
def file_too_large(error):
    return jsonify({
        "success": False,
        "message": "Photo size must be less than 10 MB."
    }), 413


initialize_database()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001, debug=True)
