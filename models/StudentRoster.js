const mongoose = require("mongoose");

const rosterStudentSchema = new mongoose.Schema({
  regNo: { type: String, required: true },
  name: { type: String, required: true },
  dob: { type: String, default: "" },
  gender: { type: String, enum: ["Boy", "Girl"], default: "Boy" },
  studentType: { type: String, enum: ["Day Scholar", "Hosteller"], default: "Day Scholar" }
}, { _id: false });

const studentRosterSchema = new mongoose.Schema({
  programme: { type: String, required: true, default: "B.E" },
  department: { type: String, required: true, default: "CSE" },
  year: { type: String, required: true },
  section: { type: String, required: true },
  students: { type: [rosterStudentSchema], default: [] },
  updatedAt: { type: Date, default: Date.now }
});

// Unique per cohort
studentRosterSchema.index({ programme: 1, department: 1, year: 1, section: 1 }, { unique: true });

module.exports = mongoose.model("StudentRoster", studentRosterSchema);
