
# --------------------------------------------------
# CITIZEN REPORTS - CREATE (DEMO GOVERNMENT SUBMISSION)
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

        demo_submitted_at = datetime.now(timezone.utc).isoformat()

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

        report = {
            "id": report_id,
            "reportType": report_type,
            "location": location,
            "description": description,
            "photo": (
                f"/uploads/{photo_name}"
                if photo_name else None
            ),
            "status": "Received",
            "department": department,
            "demoSubmissionId": demo_submission_id,
            "demoSubmissionStatus": "SIMULATION_ONLY_NOT_SENT",
            "demoSubmittedAt": demo_submitted_at,
            "createdAt": created_at
        }

    except Exception:
        connection.rollback()
        raise

    finally:
        connection.close()

    return jsonify({
        "success": True,
        "message": "Demo report recorded locally. Not sent to government.",
        "report": report,
        "simulationOnly": True
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
        "notice": "All department submissions shown here are simulations. No report is sent to any government department."
    }), 200
