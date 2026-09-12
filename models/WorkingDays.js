const mongoose = require("mongoose");

const WorkingDaysSchema = new mongoose.Schema({
  year: { type: String, required: true, unique: true }, // e.g., "I", "II", "III", "IV"
  startDate: { type: String, required: true }, // "YYYY-MM-DD"
  endDate: { type: String, required: true }    // "YYYY-MM-DD"
}, { timestamps: true });

module.exports = mongoose.model("WorkingDays", WorkingDaysSchema);
