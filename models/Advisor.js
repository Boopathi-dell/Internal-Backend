const mongoose = require("mongoose");

const advisorSchema = new mongoose.Schema({
  programme: { type: String, required: true },
  department: { type: String, required: true },
  year: { type: String, required: true },
  section: { type: String, required: true },
  advisorName: { type: String, required: true }
}, { timestamps: true });

// Ensure unique index for combination of programme, department, year, and section
advisorSchema.index({ programme: 1, department: 1, year: 1, section: 1 }, { unique: true });

module.exports = mongoose.model("Advisor", advisorSchema);
