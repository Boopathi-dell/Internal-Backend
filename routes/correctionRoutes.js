const express = require("express");
const router = express.Router();
const CorrectionRequest = require("../models/CorrectionRequest");
const Class = require("../models/Class");

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
    const { status, adminRemarks, newMark } = req.body;
    if (!["Pending", "Approved", "Rejected"].includes(status)) {
      return res.status(400).json({ error: "Invalid status value" });
    }
    
    // 1. Get the request first so we have details if we need to update mark
    const request = await CorrectionRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: "Request not found" });

    // 2. If status is Approved and newMark is provided, update the Class document
    if (status === "Approved" && newMark !== undefined && newMark !== "") {
      const cls = await Class.findOne({ className: request.className, examName: request.examName });
      if (cls) {
        // Find subject index
        let subjectIndex = -1;
        if (cls.courseDetails && cls.courseDetails.length > 0) {
          subjectIndex = cls.courseDetails.findIndex(c => c.courseCode === request.subjectCode);
        } else {
          // Fallback to subjects array matching if courseDetails not available
          // (assuming subjectName match or we skip if we can't find it reliably)
          subjectIndex = cls.subjects.findIndex(s => s === request.subjectName || s.includes(request.subjectCode));
        }

        if (subjectIndex !== -1) {
          const studentIndex = cls.students.findIndex(s => s.regNo === request.studentRegNo);
          if (studentIndex !== -1) {
            const student = cls.students[studentIndex];
            
            // Ensure marks array exists and has length
            if (!student.marks) student.marks = new Array(cls.subjects.length).fill("");
            
            // Update the mark
            student.marks[subjectIndex] = String(newMark);

            // Recalculate total, percentage, result for this student
            let total = 0;
            let fail = false;
            const maxTotal = cls.subjects.length * cls.markPerSubject;

            student.marks.forEach(val => {
              const strVal = String(val || "").toUpperCase();
              if (strVal === "AB" || strVal === "A") {
                fail = true;
              } else {
                const numVal = Number(strVal || 0);
                total += (isNaN(numVal) ? 0 : numVal);
                if (numVal < cls.passMark) fail = true;
              }
            });

            student.total = total;
            student.percentage = maxTotal > 0 ? Number(((total / maxTotal) * 100).toFixed(2)) : 0;
            student.result = fail ? "Fail" : "Pass";

            // Mark array as modified for mongoose
            cls.markModified('students');
            await cls.save();

            // Also update the currentMark in the CorrectionRequest to show the new mark
            request.currentMark = String(newMark);
          }
        }
      }
    }

    // 3. Update the request status and remarks
    request.status = status;
    if (adminRemarks !== undefined) {
      request.adminRemarks = adminRemarks;
    }

    await request.save();
    
    res.json(request);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
