const mongoose = require("mongoose");

const columnSchema = new mongoose.Schema({
  heading: { type: String, required: true },
  type: { type: String, enum: ["exam", "formula"], required: true },
  examName: { type: String }, // e.g. 'UNIT I'
  formula: { type: String }, // e.g. '(#[UNIT I] + #[UNIT II] + #[CIA I]) / 110 * 10'
  isHidden: { type: Boolean, default: false }
});

const internalMarkTemplateSchema = new mongoose.Schema({
  templateName: { type: String, required: true },
  regulation: { type: String, required: true },
  passMark: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  headerImage: { type: String, default: "" },
  columns: [columnSchema],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("InternalMarkTemplate", internalMarkTemplateSchema);
