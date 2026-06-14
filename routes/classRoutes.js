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

// BULK UPDATE ACCESS CONTROL (LOCK/UNLOCK) FOR CLASSES
router.post("/bulk-access", async (req, res) => {
  try {
    const { classNames, allowEditing, editingStartDate, editingEndDate, editingStartTime, editingEndTime } = req.body;
    if (!Array.isArray(classNames) || classNames.length === 0) {
      return res.status(400).json({ error: "classNames must be a non-empty array" });
    }
    
    const updateFields = { allowEditing: allowEditing };
    if (allowEditing) {
      updateFields.editingStartDate = editingStartDate || "";
      updateFields.editingEndDate = editingEndDate || "";
      updateFields.editingStartTime = editingStartTime || "";
      updateFields.editingEndTime = editingEndTime || "";
    } else {
      updateFields.editingStartDate = "";
      updateFields.editingEndDate = "";
      updateFields.editingStartTime = "";
      updateFields.editingEndTime = "";
    }
    
    await ClassData.updateMany(
      { className: { $in: classNames } },
      { $set: updateFields }
    );
    
    res.json({ message: `Successfully updated ${classNames.length} class(es).` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// CREATE OR UPDATE A CLASS (Admin Panel Data Setup)
router.post("/", async (req, res) => {
  try {
    const { className, subjects, passMark, examName, markPerSubject, students, courseDetails, targetPassPercentage, date, department, yearSemSec, programme, allowEditing, editingStartDate, editingEndDate, editingStartTime, editingEndTime, propagateRoster } = req.body;

    const propagateRosterToCohort = async (baseClass, roster, newCourseDetails) => {
      const otherClasses = await ClassData.find({
        programme: baseClass.programme,
        department: baseClass.department,
        yearSemSec: baseClass.yearSemSec,
        _id: { $ne: baseClass._id }
      });

      for (const otherCls of otherClasses) {
        // Propagate students (preserve existing marks by regNo)
        const updatedOtherStudents = roster.map(newStudent => {
          const existing = otherCls.students.find(s => s.regNo === newStudent.regNo);
          if (existing) {
            const marks = existing.marks || Array(otherCls.subjects.length).fill("");
            return {
              ...existing.toObject(),
              name: newStudent.name,
              regNo: newStudent.regNo,
              gender: newStudent.gender || existing.gender,
              studentType: newStudent.studentType || existing.studentType,
              dob: newStudent.dob || existing.dob,
              marks: marks
            };
          }
          return {
            ...newStudent,
            marks: Array(otherCls.subjects.length).fill("")
          };
        });
        otherCls.students = updatedOtherStudents;

        // Propagate course details (subjects / faculty info) to the other class
        if (newCourseDetails && newCourseDetails.length > 0) {
          otherCls.courseDetails = newCourseDetails;
          // Keep subjects array in sync with course codes
          otherCls.subjects = newCourseDetails.map(cd => cd.courseCode || "");
        }

        await otherCls.save();
      }
    };

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
      if (editingStartTime !== undefined) cls.editingStartTime = editingStartTime;
      if (editingEndTime !== undefined) cls.editingEndTime = editingEndTime;
      
      // Preserve existing marks for students that are kept, add new ones empty
      const updatedStudents = students.map(newStudent => {
        const existing = cls.students.find(s => s.regNo === newStudent.regNo);
        if (existing) {
          // ensure marks array is same length as new subjects
          const marks = existing.marks || Array(subjects.length).fill("");
          return { ...existing.toObject(), name: newStudent.name, regNo: newStudent.regNo, gender: newStudent.gender || existing.gender, studentType: newStudent.studentType || existing.studentType, dob: newStudent.dob !== undefined ? newStudent.dob : existing.dob, marks: marks };
        }
        return { ...newStudent, marks: Array(subjects.length).fill("") };
      });
      cls.students = updatedStudents;
      await cls.save();

      if (propagateRoster) {
        await propagateRosterToCohort(cls, students, courseDetails);
      }

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
        editingEndDate: editingEndDate || "",
        editingStartTime: editingStartTime || "",
        editingEndTime: editingEndTime || ""
      });
      await newClass.save();

      if (propagateRoster) {
        await propagateRosterToCohort(newClass, students, courseDetails);
      }

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
    const istDate = new Date(now.getTime() + 19800000); // UTC + 5.5 hours
    const year = istDate.getUTCFullYear();
    const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(istDate.getUTCDate()).padStart(2, '0');
    const hours = String(istDate.getUTCHours()).padStart(2, '0');
    const minutes = String(istDate.getUTCMinutes()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}T${hours}:${minutes}`; // YYYY-MM-DDThh:mm

    if (cls.editingStartDate) {
      const startLimit = cls.editingStartDate + "T" + (cls.editingStartTime || "00:00");
      if (todayStr < startLimit) {
        return res.status(403).json({ error: `Mark entry is only allowed starting from ${formatDate(cls.editingStartDate)} ${cls.editingStartTime || "00:00"}.` });
      }
    }
    if (cls.editingEndDate) {
      const endLimit = cls.editingEndDate + "T" + (cls.editingEndTime || "23:59");
      if (todayStr > endLimit) {
        return res.status(403).json({ error: `Mark entry has expired on ${formatDate(cls.editingEndDate)} ${cls.editingEndTime || "23:59"}.` });
      }
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
