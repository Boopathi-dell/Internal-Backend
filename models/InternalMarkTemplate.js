const mongoose = require("mongoose");

const columnSchema = new mongoose.Schema({
  colKey: { type: String },
  heading: { type: String, required: true },
  type: { type: String, enum: ["exam", "formula"], required: true },
  examName: { type: String }, // e.g. 'UNIT I'
  formula: { type: String }, // e.g. '(#[UNIT I] + #[UNIT II] + #[CIA I]) / 110 * 10'
  calcSources: { type: [String], default: undefined },
  calcType: { type: String },
  calcOutof: { type: Number },
  calcWeightage: { type: Number },
  isHidden: { type: Boolean, default: false }
});

const internalMarkTemplateSchema = new mongoose.Schema({
  templateName: { type: String, required: true },
  regulation: { type: String, required: true },
  courseCategory: { type: String, enum: ["Theory", "Lab"], default: "Theory" },
  printOrientation: { type: String, enum: ["landscape", "portrait"], default: "landscape" },
  passMark: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  headerImage: { type: String, default: "" },
  columns: [columnSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("InternalMarkTemplate", internalMarkTemplateSchema);
