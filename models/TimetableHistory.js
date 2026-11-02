const mongoose = require("mongoose");

const timetableHistorySchema = new mongoose.Schema({
  department: { type: String, default: "CSE" },
  academicYear: { type: String, default: "2026-2027" },
  semesterType: { type: String, enum: ["Odd", "Even"], default: "Odd" },
  versionName: { type: String, default: "" },
  classes: { type: Array, default: [] },
  isLocked: { type: Boolean, default: false },
  generatedAt: { type: Date, default: Date.now }
});

timetableHistorySchema.index({ department: 1, academicYear: 1, semesterType: 1, generatedAt: -1 });

module.exports = mongoose.model("TimetableHistory", timetableHistorySchema);
