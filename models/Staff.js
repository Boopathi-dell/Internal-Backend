const mongoose = require("mongoose");

const staffSchema = new mongoose.Schema({
  name: { type: String, required: true },
  staffCode: { type: String, default: "" },
  email: { type: String, default: "" },
  department: { type: String, default: "CSE" },
  designation: { type: String, default: "Assistant Professor" },
  maxHoursPerWeek: { type: Number, default: 18 },
  maxTheory: { type: Number, default: 2 },
  maxLab: { type: Number, default: 2 },
  phone: { type: String, default: "" },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Staff", staffSchema);
