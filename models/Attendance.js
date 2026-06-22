const mongoose = require("mongoose");

const attendanceStudentSchema = new mongoose.Schema({
  regNo: { type: String, required: true },
  name: { type: String, required: true },
  status: { type: String, enum: ["Present", "Absent"], default: "Present" }
});

const attendanceSchema = new mongoose.Schema({
  date: { type: String, required: true }, // Format: YYYY-MM-DD
  programme: { type: String, required: true },
  department: { type: String, default: "CSE" },
  year: { type: String, required: true }, // e.g., "II", "III", "IV"
  section: { type: String, required: true }, // e.g., "A", "B", etc.
  advisorName: { type: String, required: true },
  students: [attendanceStudentSchema],
  totalCount: { type: Number, default: 0 },
  presentCount: { type: Number, default: 0 },
  absentCount: { type: Number, default: 0 },
  submitted: { type: Boolean, default: false }
}, { timestamps: true });

// Index to ensure only one attendance record per class per day
attendanceSchema.index({ date: 1, programme: 1, department: 1, year: 1, section: 1 }, { unique: true });

module.exports = mongoose.model("Attendance", attendanceSchema);
