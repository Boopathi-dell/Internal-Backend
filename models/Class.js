const mongoose = require("mongoose");

const studentSchema = new mongoose.Schema({
  regNo: String,
  name: String,
  dob: { type: String, default: "" },
  gender: { type: String, enum: ["Boy", "Girl"], default: "Boy" },
  studentType: { type: String, enum: ["Day Scholar", "Hosteller"], default: "Day Scholar" },
  marks: [String],
  total: { type: Number, default: 0 },
  percentage: { type: Number, default: 0 },
  result: { type: String, default: "-" },
  attendance: { type: String, default: "" }
});

const courseDetailSchema = new mongoose.Schema({
  courseCode: String,
  courseName: String,
  shortName: String,
  facultyName: String,
  credits: { type: Number, default: 3 }
});

const classSchema = new mongoose.Schema({
  className: { type: String, required: true, unique: true },
  subjects: { type: [String], default: [] },
  courseDetails: { type: [courseDetailSchema], default: [] },
  targetPassPercentage: { type: Number, default: 85 },
  passMark: { type: Number, required: true },
  examName: { type: String, required: true },
  markPerSubject: { type: Number, required: true },
  students: { type: [studentSchema], default: [] },
  date: { type: String, default: "" },
  department: { type: String, default: "CSE" },
  yearSemSec: { type: String, default: "II/IV/A" },
  programme: { type: String, default: "B.E" },
  allowEditing: { type: Boolean, default: true },
  editingStartDate: { type: String, default: "" },
  editingEndDate: { type: String, default: "" },
  editingStartTime: { type: String, default: "" },
  editingEndTime: { type: String, default: "" },
  eseGradingSystem: { type: String, default: "System 2" },
  semesterProgress: {
    type: Map,
    of: new mongoose.Schema({
      total: { type: String, default: "" },
      pass: { type: String, default: "" },
      percentage: { type: String, default: "" }
    }, { _id: false }),
    default: {}
  },
  iqacPrefix: { type: String, default: "MEC/IQAC/2026-27/COE/" },
  academicYearText: { type: String, default: " (2026-27)" },
  actionTakenSubjects: { type: [String], default: [] },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null }
});

module.exports = mongoose.model("Class", classSchema);
