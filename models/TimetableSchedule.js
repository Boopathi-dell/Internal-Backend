const mongoose = require("mongoose");

const periodSlotSchema = new mongoose.Schema({
  period: { type: Number, required: true },
  time: { type: String, default: "" },
  subjectCode: { type: String, default: "" },
  subjectName: { type: String, default: "" },
  shortName: { type: String, default: "" },
  facultyName: { type: String, default: "" },
  facultyNames: { type: [String], default: [] },
  type: { type: String, default: "Theory" },
  room: { type: String, default: "" }
}, { _id: false });

const classScheduleSchema = new mongoose.Schema({
  classKey: { type: String, required: true }, // e.g. "II-A", "III-A", "IV-A"
  year: { type: String, required: true },     // "II", "III", "IV"
  semester: { type: Number, required: true },
  section: { type: String, default: "A" },
  days: {
    Monday: { type: [periodSlotSchema], default: [] },
    Tuesday: { type: [periodSlotSchema], default: [] },
    Wednesday: { type: [periodSlotSchema], default: [] },
    Thursday: { type: [periodSlotSchema], default: [] },
    Friday: { type: [periodSlotSchema], default: [] }
  }
}, { _id: false });

const timetableScheduleSchema = new mongoose.Schema({
  department: { type: String, default: "CSE" },
  academicYear: { type: String, default: "2026-2027" },
  semesterType: { type: String, enum: ["Odd", "Even"], default: "Odd" },
  classes: { type: [classScheduleSchema], default: [] },
  isLocked: { type: Boolean, default: false },
  lockedBy: { type: String, default: "" },
  lockedAt: { type: Date },
  generatedAt: { type: Date, default: Date.now }
});

timetableScheduleSchema.index({ department: 1, academicYear: 1, semesterType: 1 }, { unique: true });

module.exports = mongoose.model("TimetableSchedule", timetableScheduleSchema);
