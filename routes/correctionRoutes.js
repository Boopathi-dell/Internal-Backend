const express = require("express");
const router = express.Router();
const CorrectionRequest = require("../models/CorrectionRequest");
const EmailSettings = require("../models/EmailSettings");
const { sendCorrectionNotification } = require("../utils/emailService");

// Create a new correction request
router.post("/", async (req, res) => {
  try {
    const { studentRegNo, studentName, className, examName, subjectCode, subjectName, currentMark, reason } = req.body;
    
    // Check if a pending request already exists for this subject and exam
    const existing = await CorrectionRequest.findOne({
      studentRegNo,
      examName,
      subjectCode,
      status: "Pending"
    });

    if (existing) {
      return res.status(400).json({ error: "A pending request already exists for this subject." });
    }

    const newRequest = new CorrectionRequest({
      studentRegNo,
      studentName,
      className,
      examName,
      subjectCode,
      subjectName,
      currentMark,
      reason
    });

    await newRequest.save();

    // Determine year from className (e.g., "II/IV/A" -> "II")
    // If not matching pattern, fallback to year1
    let adminEmail = null;
    try {
      const settings = await EmailSettings.findOne() || new EmailSettings();
      let year = "I";
      if (className.includes("II/")) year = "II";
      else if (className.includes("III/")) year = "III";
      else if (className.includes("IV/")) year = "IV";

      switch (year) {
        case "I": adminEmail = settings.year1Email; break;
        case "II": adminEmail = settings.year2Email; break;
        case "III": adminEmail = settings.year3Email; break;
        case "IV": adminEmail = settings.year4Email; break;
      }
      
      if (adminEmail) {
        // Send email asynchronously without blocking the response
        sendCorrectionNotification(newRequest, adminEmail);
      }
    } catch (emailErr) {
      console.error("Failed to trigger email notification:", emailErr);
    }

    res.status(201).json(newRequest);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all requests (for admin)
router.get("/", async (req, res) => {
  try {
    // Auto-cleanup requests older than 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await CorrectionRequest.deleteMany({ createdAt: { $lt: thirtyDaysAgo } });

    const requests = await CorrectionRequest.find().sort({ createdAt: -1 });
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get requests by student regNo
router.get("/student/:regNo", async (req, res) => {
  try {
    const requests = await CorrectionRequest.find({ studentRegNo: req.params.regNo });
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update request status
router.put("/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    if (!["Pending", "Approved", "Rejected"].includes(status)) {
      return res.status(400).json({ error: "Invalid status value" });
    }
    
    const request = await CorrectionRequest.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    
    if (!request) return res.status(404).json({ error: "Request not found" });
    res.json(request);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
