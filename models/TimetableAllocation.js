const mongoose = require("mongoose");

const singleAllocationSchema = new mongoose.Schema({
  id: { type: String, required: true },
  year: { type: String, enum: ["I", "II", "III", "IV"], required: true },
  semester: { type: Number, required: true },
  section: { type: String, default: "A" },
  subjectCode: { type: String, required: true },
  subjectName: { type: String, required: true },
  shortName: { type: String, default: "" },
  type: { type: String, default: "Theory" },
  difficulty: { type: String, enum: ["Tough", "Normal", "Light"], default: "Normal" },
  hoursPerWeek: { type: Number, default: 4 },
  facultyNames: { type: [String], default: [] },
  facultyIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Staff" }]
});

const timetableAllocationSchema = new mongoose.Schema({
  department: { type: String, default: "CSE" },
  academicYear: { type: String, default: "2026-2027" },
  semesterType: { type: String, enum: ["Odd", "Even"], default: "Odd" },
  allocations: { type: [singleAllocationSchema], default: [] },
  yearSections: { type: Object, default: { "II": ["A", "B"], "III": ["A", "B"], "IV": ["A", "B", "C"] } },
  classAdvisors: { type: Object, default: {} },
  iqacNumber: { type: String, default: "MEC/IQAC/2026 - 27/CSE/006" },
  hallNumbers: { type: Object, default: {} },
  coordinators: { type: Object, default: {} },
  periodTimings: { type: Object, default: {} },
  updatedAt: { type: Date, default: Date.now }
});

timetableAllocationSchema.index({ department: 1, academicYear: 1, semesterType: 1 }, { unique: true });

module.exports = mongoose.model("TimetableAllocation", timetableAllocationSchema);
