const mongoose = require("mongoose");

const masterSubjectItemSchema = new mongoose.Schema({
  courseCode: { type: String, required: true, trim: true },
  courseName: { type: String, required: true, trim: true },
  shortName: { type: String, default: "", trim: true },
  credits: { type: Number, default: 3 },
  category: { type: String, enum: ["Theory", "Lab", "Other"], default: "Theory" }
}, { _id: false });

const cohortSubjectMasterSchema = new mongoose.Schema({
  cohortKey: { type: String, required: true, unique: true }, // e.g. "B.E-CSE - III/V"
  programme: { type: String, default: "B.E", trim: true },
  department: { type: String, default: "CSE", trim: true },
  year: { type: String, required: true, trim: true },
  semester: { type: String, required: true, trim: true },
  subjects: { type: [masterSubjectItemSchema], default: [] }
}, { timestamps: true });

cohortSubjectMasterSchema.index({ programme: 1, department: 1, year: 1, semester: 1 });

const staffAssignmentItemSchema = new mongoose.Schema({
  courseCode: { type: String, required: true, trim: true },
  facultyName: { type: String, default: "", trim: true }
}, { _id: false });

const sectionStaffMappingSchema = new mongoose.Schema({
  cohortName: { type: String, required: true, unique: true }, // e.g. "B.E-CSE - III/V/A"
  programme: { type: String, default: "B.E", trim: true },
  department: { type: String, default: "CSE", trim: true },
  year: { type: String, required: true, trim: true },
  semester: { type: String, required: true, trim: true },
  section: { type: String, required: true, trim: true },
  staffAssignments: { type: [staffAssignmentItemSchema], default: [] }
}, { timestamps: true });

sectionStaffMappingSchema.index({ programme: 1, department: 1, year: 1, semester: 1, section: 1 });

const CohortSubjectMaster = mongoose.model("CohortSubjectMaster", cohortSubjectMasterSchema);
const SectionStaffMapping = mongoose.model("SectionStaffMapping", sectionStaffMappingSchema);

module.exports = { CohortSubjectMaster, SectionStaffMapping };

