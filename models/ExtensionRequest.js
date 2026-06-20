const mongoose = require("mongoose");

const extensionRequestSchema = new mongoose.Schema({
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  className: { type: String, required: true },
  facultyName: { type: String }, // Optional, can store the name of the faculty who requested
  facultyId: { type: String }, // Store the ID of the faculty who requested
  requestedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' }
});

module.exports = mongoose.model("ExtensionRequest", extensionRequestSchema);
