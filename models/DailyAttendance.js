const mongoose = require("mongoose");

const DailyAttendanceSchema = new mongoose.Schema({
  cohortName: { type: String, required: true }, // e.g., "B.E-CSE - II/IV/A"
  date: { type: String, required: true }, // "YYYY-MM-DD" format
  session: { type: String, enum: ["Morning", "Afternoon"], required: true },
  isHoliday: { type: Boolean, default: false },
  holidayReason: { type: String, default: "" },
  records: [
    {
      regNo: { type: String, required: true },
      name: { type: String }, // Storing name for easier UI rendering later
      status: { type: String, enum: ["Present", "Absent", "OD", "Leave"], default: "Present" }
    }
  ]
}, { timestamps: true });

// Create a unique index to prevent duplicate entries for same class, date, and session
DailyAttendanceSchema.index({ cohortName: 1, date: 1, session: 1 }, { unique: true });

module.exports = mongoose.model("DailyAttendance", DailyAttendanceSchema);
