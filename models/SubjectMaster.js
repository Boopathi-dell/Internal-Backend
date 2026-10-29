const mongoose = require("mongoose");

const singleSubjectSchema = new mongoose.Schema({
  code: { type: String, required: true },
  name: { type: String, required: true },
  shortName: { type: String, default: "" },
  type: { type: String, default: "Theory" },
  hoursPerWeek: { type: Number, default: 4 },
  credits: { type: Number, default: 3 }
});

const subjectMasterSchema = new mongoose.Schema({
  department: { type: String, default: "CSE" },
  batch: { type: String, required: true }, // e.g. "2023-2027"
  year: { type: String, enum: ["I", "II", "III", "IV"], required: true },
  semester: { type: Number, required: true }, // e.g. 3, 4, 5, 6, 7, 8
  subjects: { type: [singleSubjectSchema], default: [] },
  updatedAt: { type: Date, default: Date.now }
});

// Unique compound index so each (dept, batch, year, sem) is distinct
subjectMasterSchema.index({ department: 1, batch: 1, year: 1, semester: 1 }, { unique: true });

module.exports = mongoose.model("SubjectMaster", subjectMasterSchema);
