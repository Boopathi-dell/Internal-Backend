const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  department: { type: String, required: true },
  designation: { type: String, required: true },
  password: { type: String, required: true },
  plainPassword: { type: String },
  approved: { type: Boolean, default: false },
  adminTabs: { type: [String], default: [] },
  dashboardTabs: { type: [String], default: ["daily-attendance", "attendance", "entry"] },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("User", userSchema);
