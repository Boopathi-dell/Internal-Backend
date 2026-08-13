const mongoose = require("mongoose");

const hallSchema = new mongoose.Schema({
  hallNumber: { type: String, required: true, unique: true },
  totalCapacity: { type: Number, required: true },
  columns: { type: Number, required: true },
  layoutType: { type: String, enum: ['Standard', 'Library'], default: 'Standard' },
}, { timestamps: true });

module.exports = mongoose.model("Hall", hallSchema);
