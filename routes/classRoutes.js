const express = require("express");
const router = express.Router();
const ClassData = require("../models/Class");

const formatDate = (dateStr) => {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  return `${day}-${month}-${year}`;
};


// GET ALL CLASSES
router.get("/", async (req, res) => {
  try {
    const classes = await ClassData.find();
    res.json(classes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CREATE OR UPDATE A CLASS (Admin Panel Data Setup)
router.post("/", async (req, res) => {
  try {
    const { className, subjects, passMark, examName, markPerSubject, students, courseDetails, targetPassPercentage, date, department, yearSemSec, programme, allowEditing, editingStartDate, editingEndDate } = req.body;

    let cls = await ClassData.findOne({ className });
    if (cls) {
      // Update existing
      cls.subjects = subjects;
      cls.passMark = passMark;
      cls.examName = examName;
      cls.markPerSubject = markPerSubject;
      if (courseDetails) cls.courseDetails = courseDetails;
      if (targetPassPercentage) cls.targetPassPercentage = targetPassPercentage;
      if (date !== undefined) cls.date = date;
      if (department !== undefined) cls.department = department;
      if (yearSemSec !== undefined) cls.yearSemSec = yearSemSec;
      if (programme !== undefined) cls.programme = programme;
      if (allowEditing !== undefined) cls.allowEditing = allowEditing;
      if (editingStartDate !== undefined) cls.editingStartDate = editingStartDate;
      if (editingEndDate !== undefined) cls.editingEndDate = editingEndDate;
      
      // Preserve existing marks for students that are kept, add new ones empty
      const updatedStudents = students.map(newStudent => {
        const existing = cls.students.find(s => s.regNo === newStudent.regNo);
        if (existing) {
          // ensure marks array is same length as new subjects
          const marks = existing.marks || Array(subjects.length).fill("");
          return { ...existing.toObject(), name: newStudent.name, regNo: newStudent.regNo, gender: newStudent.gender || existing.gender, studentType: newStudent.studentType || existing.studentType, marks: marks };
        }
        return { ...newStudent, marks: Array(subjects.length).fill("") };
      });
      cls.students = updatedStudents;
      await cls.save();
      return res.json(cls);
    } else {
      // Create new
      const sList = students.map(s => ({
        ...s,
        marks: Array(subjects.length).fill("")
      }));
      const newClass = new ClassData({
        className,
        subjects,
        passMark,
        examName,
        markPerSubject,
        students: sList,
        courseDetails: courseDetails || [],
        targetPassPercentage: targetPassPercentage || 85,
        date: date || "",
        department: department || "CSE",
        yearSemSec: yearSemSec || "II/IV/A",
        programme: programme || "B.E",
        allowEditing: allowEditing !== undefined ? allowEditing : true,
        editingStartDate: editingStartDate || "",
        editingEndDate: editingEndDate || ""
      });
      await newClass.save();
      return res.json(newClass);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE A CLASS
router.delete("/:className", async (req, res) => {
  try {
    await ClassData.findOneAndDelete({ className: req.params.className });
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SAVE MARKS AND RECALCULATE RESULT
router.post("/:className/marks", async (req, res) => {
  try {
    const { students } = req.body; 
    // students array with regNo, name, and marks array
    const cls = await ClassData.findOne({ className: req.params.className });
    if (!cls) return res.status(404).json({ error: "Class not found" });

    if (cls.allowEditing === false) {
      return res.status(403).json({ error: "Mark entry is locked for this class." });
    }

    // Check date range if specified
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const istDate = new Date(utc + (3600000 * 5.5));
    const todayStr = istDate.toISOString().split('T')[0]; // "YYYY-MM-DD"

    if (cls.editingStartDate && todayStr < cls.editingStartDate) {
      return res.status(403).json({ error: `Mark entry is only allowed starting from ${formatDate(cls.editingStartDate)}.` });
    }
    if (cls.editingEndDate && todayStr > cls.editingEndDate) {
      return res.status(403).json({ error: `Mark entry has expired on ${formatDate(cls.editingEndDate)}.` });
    }

    const maxTotal = cls.subjects.length * cls.markPerSubject;

    const computedStudents = students.map(s => {
      let total = 0;
      let fail = false;

      const marks = s.marks || [];
      marks.forEach((val, idx) => {
        const strVal = String(val || "").toUpperCase();
        if (strVal === "AB" || strVal === "A") {
           fail = true;
        } else {
          const numVal = Number(strVal || 0);
          total += (isNaN(numVal) ? 0 : numVal);
          if (numVal < cls.passMark) fail = true;
        }
      });

      const percentage = maxTotal > 0 ? (total / maxTotal) * 100 : 0;

      return {
        ...s,
        marks: marks,
        total,
        percentage: Number(percentage.toFixed(2)),
        result: fail ? "Fail" : "Pass"
      };
    });

    cls.students = computedStudents;
    await cls.save();
    
    res.json(cls);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE SEMESTER PROGRESS DATA
router.post("/:className/progress", async (req, res) => {
  try {
    const { semesterProgress } = req.body;
    const cls = await ClassData.findOne({ className: req.params.className });
    if (!cls) return res.status(404).json({ error: "Class not found" });

    cls.semesterProgress = semesterProgress;
    await cls.save();
    res.json(cls);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET A SINGLE CLASS (For Entry, Analysis, Rank)
router.get("/:className", async (req, res) => {
  try {
    const cls = await ClassData.findOne({ className: req.params.className });
    if (!cls) return res.status(404).json({ error: "Class not found" });
    res.json(cls);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
