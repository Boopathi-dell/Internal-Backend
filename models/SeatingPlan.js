const mongoose = require("mongoose");

const seatingPlanSchema = new mongoose.Schema({
  examDate: { type: String, required: true },
  iqacNumber: { type: String, default: "" },
  halls: [{ type: mongoose.Schema.Types.ObjectId, ref: "Hall" }],
  // allocations will hold an array of objects.
  // Each object corresponds to a Hall and contains the arranged register numbers.
  allocations: [{
    hallId: { type: mongoose.Schema.Types.ObjectId, ref: "Hall" },
    hallNumber: { type: String },
    // 2D Array: each inner array represents a column in the hall.
    columnsData: [[String]],
    summaryInfo: { type: String } // e.g., "CSE/II Year / III Sem - 40"
  }],
}, { timestamps: true });

module.exports = mongoose.model("SeatingPlan", seatingPlanSchema);
