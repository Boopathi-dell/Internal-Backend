const mongoose = require("mongoose");

const emailSettingsSchema = new mongoose.Schema({
  year1Email: { type: String, default: "" },
  year2Email: { type: String, default: "" },
  year3Email: { type: String, default: "" },
  year4Email: { type: String, default: "" }
});

module.exports = mongoose.model("EmailSettings", emailSettingsSchema);
