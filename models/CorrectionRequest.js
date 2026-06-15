const mongoose = require("mongoose");

const correctionRequestSchema = new mongoose.Schema({
  studentRegNo: { type: String, required: true },
  studentName: { type: String, required: true },
  className: { type: String, required: true },
  examName: { type: String, required: true },
  subjectCode: { type: String, required: true },
  subjectName: { type: String, required: true },
  currentMark: { type: String, required: true },
  reason: { type: String, required: true },
  adminRemarks: { type: String, default: "" },
  status: { type: String, enum: ["Pending", "Approved", "Rejected"], default: "Pending" },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("CorrectionRequest", correctionRequestSchema);
