const mongoose = require("mongoose");

const studentSchema = new mongoose.Schema({
  name: String,
  regNo: String,
  sub1: Number,
  sub2: Number,
  sub3: Number,
  sub4: Number,
  sub5: Number,
  sub6: Number,
  total: Number,
  percentage: Number,
  result: String
});

module.exports = mongoose.model("Student", studentSchema);