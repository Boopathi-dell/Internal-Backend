const mongoose = require("mongoose");

const yearApprovalSchema = new mongoose.Schema({
  year: { type: String, required: true, unique: true }, // "I", "II", "III", "IV"
  isApproved: { type: Boolean, default: true }
});

module.exports = mongoose.model("YearApproval", yearApprovalSchema);
