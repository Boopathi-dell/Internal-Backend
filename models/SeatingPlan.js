const mongoose = require("mongoose");

const seatingPlanSchema = new mongoose.Schema({
  examDate: { type: String, required: true },
  examName: { type: String, default: "" },
  academicYear: { type: String, default: "" },
  iqacNumber: { type: String, default: "" },
  halls: [{ type: mongoose.Schema.Types.ObjectId, ref: "Hall" }],
  // allocations will hold an array of objects.
  // Each object corresponds to a Hall and contains the arranged register numbers.
  allocations: [{
    hallId: { type: mongoose.Schema.Types.ObjectId, ref: "Hall" },
    hallNumber: { type: String },
    layoutType: { type: String, default: 'Standard' },
    // 2D Array: each inner array represents a column in the hall (Standard).
    columnsData: [[String]],
    // Object containing computerTables and readingTables arrays (Library).
    libraryData: { type: mongoose.Schema.Types.Mixed },
    summaryInfo: { type: String }, // e.g., "CSE/II Year / III Sem - 40"
    summaryRanges: [{
      branch: { type: String },
      range: { type: String },
      count: { type: Number }
    }],
    totalAllocated: { type: Number }
  }],
}, { timestamps: true });

module.exports = mongoose.model("SeatingPlan", seatingPlanSchema);
