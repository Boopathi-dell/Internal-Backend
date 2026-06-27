const mongoose = require("mongoose");

const adminSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'printAdmin'], default: 'admin' },
  securityCode: { type: String, default: "" },
  securityQuestion: { type: String, default: "" },
  securityAnswer: { type: String, default: "" }
});

module.exports = mongoose.model("Admin", adminSchema);
