const express = require("express");
const router = express.Router();
const CorrectionRequest = require("../models/CorrectionRequest");

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
    res.status(201).json(newRequest);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all requests (for admin)
router.get("/", async (req, res) => {
  try {
    const requests = await CorrectionRequest.find().sort({ createdAt: -1 });
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get requests by student regNo
router.get("/student/:regNo", async (req, res) => {
  try {
    const requests = await CorrectionRequest.find({ studentRegNo: req.params.regNo }).sort({ createdAt: -1 });
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get pending request count
router.get("/pending-count", async (req, res) => {
  try {
    const count = await CorrectionRequest.countDocuments({ status: "Pending" });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update request status
router.put("/:id/status", async (req, res) => {
  try {
    const { status, adminRemarks } = req.body;
    if (!["Pending", "Approved", "Rejected"].includes(status)) {
      return res.status(400).json({ error: "Invalid status value" });
    }
    
    const updateData = { status };
    if (adminRemarks !== undefined) {
      updateData.adminRemarks = adminRemarks;
    }

    const request = await CorrectionRequest.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );
    
    if (!request) return res.status(404).json({ error: "Request not found" });
    res.json(request);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
