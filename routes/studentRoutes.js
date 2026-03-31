const express = require("express");
const router = express.Router();
const Student = require("../models/Student");

// ADD STUDENT
router.post("/add", async (req, res) => {
  const { name, regNo, sub1, sub2, sub3, sub4, sub5, sub6 } = req.body;

  const total = sub1 + sub2 + sub3 + sub4 + sub5 + sub6;
  const percentage = total / 6;

  let result = "Pass";
  if (
    sub1 < 35 || sub2 < 35 || sub3 < 35 ||
    sub4 < 35 || sub5 < 35 || sub6 < 35
  ) {
    result = "Fail";
  }

  const student = new Student({
    name,
    regNo,
    sub1,
    sub2,
    sub3,
    sub4,
    sub5,
    sub6,
    total,
    percentage,
    result
  });

  await student.save();
  res.json(student);
});

// GET ALL
router.get("/all", async (req, res) => {
 let students = await Student.find();

// sort
students = students.sort((a, b) => b.total - a.total);

// assign rank properly
const rankedStudents = students.map((s, index) => {
  return {
    ...s._doc,
    rank: index + 1
  };
});

res.json(rankedStudents);
});

module.exports = router;