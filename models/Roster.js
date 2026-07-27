const mongoose = require("mongoose");

const studentRosterSchema = new mongoose.Schema({
  regNo: String,
  name: String,
  dob: { type: String, default: "" },
  gender: { type: String, enum: ["Boy", "Girl"], default: "Boy" },
  studentType: { type: String, enum: ["Day Scholar", "Hosteller"], default: "Day Scholar" }
});

const rosterSchema = new mongoose.Schema({
  cohortName: { type: String, required: true, unique: true }, // e.g. B.E-CSE - III/IV/A
  programme: { type: String, default: "B.E" },
  department: { type: String, default: "CSE" },
  year: { type: String, required: true },
  semester: { type: String, required: true },
  section: { type: String, required: true },
  students: { type: [studentRosterSchema], default: [] },
}, { timestamps: true });

module.exports = mongoose.model("Roster", rosterSchema);
