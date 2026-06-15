const mongoose = require("mongoose");

const correctionRequestSchema = new mongoose.Schema({
  studentRegNo: { type: String, required: true },
  studentName: { type: String, required: true },
  className: { type: String, required: true },
  examName: { type: String, required: true },
  subjectCode: { type: String, required: true },
  subjectName: { type: String, required: true },
  currentMark: { type: String, required: true },
  expectedMark: { type: String, default: "" },
  reason: { type: String, required: true },
  adminRemarks: { type: String, default: "" },
  status: { type: String, enum: ["Pending", "Approved", "Rejected"], default: "Pending" },
  studentRead: { type: Boolean, default: true }, // Starts true, becomes false when admin replies
  createdAt: { type: Date, default: Date.now, expires: '30d' }
});

module.exports = mongoose.model("CorrectionRequest", correctionRequestSchema);
