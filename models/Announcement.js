const mongoose = require("mongoose");

const announcementSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  category: { 
    type: String, 
    enum: ["Exam", "Holiday", "Fee", "General"], 
    default: "General" 
  },
  targetProgramme: { type: String, default: "All" },
  targetDepartment: { type: String, default: "All" },
  targetYear: { type: [String], default: ["All"] },
  targetSection: { type: [String], default: ["All"] },
  image: { type: String }, // Base64 string for circular images
  createdBy: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model("Announcement", announcementSchema);
