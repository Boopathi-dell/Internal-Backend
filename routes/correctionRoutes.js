const express = require("express");
const router = express.Router();
const CorrectionRequest = require("../models/CorrectionRequest");
const Class = require("../models/Class");
const sendEmail = require("../utils/emailService");

// Create a new correction request
router.post("/", async (req, res) => {
  try {
    const { studentRegNo, studentName, className, examName, subjectCode, subjectName, currentMark, expectedMark, reason } = req.body;
    
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
      expectedMark,
      reason
    });

    await newRequest.save();

    // Send Email Notification to Admin
    const adminEmail = process.env.ADMIN_EMAIL || "boopathi.mec.cse@gmail.com";
    const emailSubject = `New Mark Correction Request: ${subjectCode}`;
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
        <h2 style="color: #4f46e5;">New Correction Request</h2>
        <p>A new mark correction request has been submitted by a student.</p>
        <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold;">Student Name:</td>
            <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${studentName} (${studentRegNo})</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold;">Exam:</td>
            <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${examName}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold;">Subject:</td>
            <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${subjectName} (${subjectCode})</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold;">Current Mark:</td>
            <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #ef4444; font-weight: bold;">${currentMark}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold;">Expected Mark:</td>
            <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #10b981; font-weight: bold;">${expectedMark || "Not Specified"}</td>
          </tr>
        </table>
        <div style="margin-top: 20px; background: #f8fafc; padding: 15px; border-left: 4px solid #f59e0b; border-radius: 4px;">
          <strong>Student's Reason:</strong><br/>
          <p style="margin-top: 10px; font-style: italic;">"${reason}"</p>
        </div>
        <div style="margin-top: 30px; text-align: center;">
          <a href="https://internal-frontend-theta.vercel.app/requests" style="background: #4f46e5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold;">View Request</a>
        </div>
      </div>
    `;
    
    // Don't wait for email to send, run it async
    sendEmail(adminEmail, emailSubject, emailHtml).catch(e => console.error("Email failed:", e));

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

// Get pending request count (Admin)
router.get("/pending-count", async (req, res) => {
  try {
    const count = await CorrectionRequest.countDocuments({ status: "Pending" });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get unread request count for a student
router.get("/student/:regNo/unread-count", async (req, res) => {
  try {
    const count = await CorrectionRequest.countDocuments({ 
      studentRegNo: req.params.regNo,
      status: { $ne: "Pending" },
      studentRead: false 
    });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark student requests as read
router.put("/student/:regNo/mark-read", async (req, res) => {
  try {
    await CorrectionRequest.updateMany(
      { studentRegNo: req.params.regNo, studentRead: false },
      { $set: { studentRead: true } }
    );
    res.json({ success: true });
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
            const upperNewMark = String(newMark).toUpperCase();
            if (upperNewMark !== "" && upperNewMark !== "AB" && upperNewMark !== "A") {
              const markNum = Number(newMark);
              if (isNaN(markNum)) {
                return res.status(400).json({ error: "Mark must be a valid number, 'AB', or 'A'" });
              }
              if (markNum < 0) {
                return res.status(400).json({ error: "Mark cannot be negative" });
              }
              if (markNum > cls.markPerSubject) {
                return res.status(400).json({ error: `Mark cannot exceed the maximum mark of ${cls.markPerSubject}` });
              }
            }
            
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
    request.studentRead = false; // Mark unread for student
    if (adminRemarks !== undefined) {
      request.adminRemarks = adminRemarks;
    }

    await request.save();
    
    res.json(request);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk update request status
router.put("/bulk-status", async (req, res) => {
  try {
    const { requestIds, status, adminRemarks } = req.body;
    
    if (!Array.isArray(requestIds) || requestIds.length === 0) {
      return res.status(400).json({ error: "No requests selected" });
    }
    
    if (!["Pending", "Approved", "Rejected"].includes(status)) {
      return res.status(400).json({ error: "Invalid status value" });
    }
    
    const updateData = { status, studentRead: false };
    if (adminRemarks !== undefined) {
      updateData.adminRemarks = adminRemarks;
    }

    // We will do this individually to support dynamic string replacement
    const requests = await CorrectionRequest.find({ _id: { $in: requestIds } });
    
    for (const req of requests) {
      req.status = status;
      req.studentRead = false;
      if (adminRemarks !== undefined) {
        req.adminRemarks = adminRemarks
          .replace(/{name}/g, req.studentName)
          .replace(/{regNo}/g, req.studentRegNo);
      }
      await req.save();
    }
    
    res.json({ success: true, updatedCount: requests.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
