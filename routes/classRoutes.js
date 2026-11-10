const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const ClassData = require("../models/Class");
const Roster = require("../models/Roster");

const JWT_SECRET = "mec_result_system_secret_2025";

// Enforce strict Administrator role for destructive bulk mark operations
const requireStrictAdmin = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Authorization token required." });
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== "admin") {
      return res.status(403).json({ error: "Access denied. Only Administrator can clear subject marks." });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired Admin token." });
  }
};

const getGradePoint = (grade, system) => {
  const g = String(grade).toUpperCase().trim();
  if (system === "System 1") {
    const map = { "S": 10, "A+": 9, "A": 8, "B+": 7, "B": 6.5, "C+": 6, "C": 5, "U": 0, "U*": 0 };
    return map[g] !== undefined ? map[g] : 0;
  }
  const map = { "O": 10, "A+": 9, "A": 8, "B+": 7, "B": 6, "C": 5, "U": 0, "U*": 0 };
  return map[g] !== undefined ? map[g] : 0;
};

// Recompute student totals, percentages, and pass/fail status uniformly
const recalculateClassStudents = (cls, rawStudents) => {
  const isESE = cls.examName === "ESE";
  const subjectCount = (cls.subjects || []).length;
  const maxTotal = isESE ? subjectCount * 10 : subjectCount * cls.markPerSubject;

  return (rawStudents || []).map(s => {
    const studentObj = typeof s.toObject === "function" ? s.toObject() : { ...s };
    let total = 0;
    let totalGradePoints = 0;
    let totalCredits = 0;
    let fail = false;

    const marks = Array.isArray(studentObj.marks) ? [...studentObj.marks] : [];
    while (marks.length < subjectCount) marks.push("");

    marks.forEach((val, idx) => {
      const strVal = String(val || "").toUpperCase().trim();
      if (isESE) {
        if (strVal === "AB" || strVal === "U" || strVal === "U*" || strVal === "FAIL") {
          fail = true;
        }
        const gp = getGradePoint(strVal, cls.eseGradingSystem || "System 2");
        const credits = (cls.courseDetails && cls.courseDetails[idx] && cls.courseDetails[idx].credits !== undefined)
          ? Number(cls.courseDetails[idx].credits)
          : 3;
        totalGradePoints += (gp * credits);
        totalCredits += credits;
      } else {
        if (strVal === "AB" || strVal === "A") {
          fail = true;
        } else {
          const numVal = Number(strVal || 0);
          total += (isNaN(numVal) ? 0 : numVal);
          if (numVal < cls.passMark) fail = true;
        }
      }
    });

    let percentage = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
    if (isESE) {
      total = totalCredits > 0 ? Number((totalGradePoints / totalCredits).toFixed(2)) : 0;
      percentage = Math.round(total * 10);
    }

    return {
      ...studentObj,
      marks,
      total,
      percentage: Math.round(percentage),
      result: fail ? "Fail" : "Pass"
    };
  });
};

const shouldClearMarkValue = (val, isESE, passMark, mode) => {
  const strVal = String(val ?? "").toUpperCase().trim();
  if (strVal === "") return false;
  if (mode === "all") return true;
  if (mode === "absent") return strVal === "AB" || strVal === "A";
  if (mode === "fail") {
    if (isESE) {
      return ["AB", "A", "U", "U*", "FAIL", "RA", "SA", "W"].includes(strVal);
    }
    if (strVal === "AB" || strVal === "A") return true;
    const numVal = Number(strVal);
    return !isNaN(numVal) && numVal < Number(passMark);
  }
  return false;
};

const formatDate = (dateStr) => {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  return `${day}-${month}-${year}`;
};


// GET ALL CLASSES
router.get("/migrate/assignments", async (req, res) => {
  try {
    const classes = await ClassData.find({ examName: /Assignment/i });
    let count = 0;
    for (let c of classes) {
      c.examName = c.examName.replace(/Assignment/ig, "Unit Test");
      c.className = c.className.replace(/Assignment/ig, "Unit Test");
      await c.save();
      count++;
    }
    res.json({ success: true, count, message: "Migrated Assignment to Unit Test successfully!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET ALL CLASSES
router.get("/", async (req, res) => {
  try {
    const { deletedOnly, department, yearSemSec } = req.query;
    
    // Background cleanup without blocking read responses
    if (Math.random() < 0.05) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      ClassData.deleteMany({ isDeleted: true, deletedAt: { $lt: thirtyDaysAgo } }).catch(() => {});
    }

    let query = { isDeleted: { $ne: true } };
    if (deletedOnly === "true") {
      query = { isDeleted: true };
    }
    if (department) {
      query.department = department;
    }
    if (yearSemSec) {
      query.yearSemSec = yearSemSec;
    }

    const classes = await ClassData.find(query);
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

// BULK DELETE CLASSES (Move to Recycle Bin)
router.post("/bulk-delete", async (req, res) => {
  try {
    const { classNames } = req.body;
    if (!Array.isArray(classNames) || classNames.length === 0) {
      return res.status(400).json({ error: "classNames must be a non-empty array" });
    }
    await ClassData.updateMany(
      { className: { $in: classNames } },
      { $set: { isDeleted: true, deletedAt: new Date() } }
    );
    res.json({ message: `Successfully moved ${classNames.length} class(es) to Recycle Bin.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// BULK RESTORE CLASSES (From Recycle Bin)
router.post("/bulk-restore", async (req, res) => {
  try {
    const { classNames } = req.body;
    if (!Array.isArray(classNames) || classNames.length === 0) {
      return res.status(400).json({ error: "classNames must be a non-empty array" });
    }
    await ClassData.updateMany(
      { className: { $in: classNames } },
      { $set: { isDeleted: false, deletedAt: null } }
    );
    res.json({ message: `Successfully restored ${classNames.length} class(es).` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// BULK PURGE CLASSES (Permanently Delete)
router.post("/bulk-purge", async (req, res) => {
  try {
    const { classNames } = req.body;
    if (!Array.isArray(classNames) || classNames.length === 0) {
      return res.status(400).json({ error: "classNames must be a non-empty array" });
    }
    await ClassData.deleteMany({ className: { $in: classNames }, isDeleted: true });
    res.json({ message: `Successfully permanently deleted ${classNames.length} class(es).` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SAVE ROSTER ONLY
router.post("/roster", async (req, res) => {
  try {
    const { students, department, yearSemSec, programme } = req.body;
    
    const otherClasses = await ClassData.find({ programme, department, yearSemSec });
    
    if (otherClasses.length === 0) {
      // Create a base roster class to hold the students
      const baseClassName = `${programme}-${department} - ${yearSemSec.replace(/\//g, '/')} - Base Roster`;
      await ClassData.deleteOne({ className: baseClassName });
      const newCls = new ClassData({
        className: baseClassName,
        examName: "Base Roster",
        passMark: 0,
        markPerSubject: 0,
        students: students,
        department,
        yearSemSec,
        programme,
        isDeleted: false
      });
      await newCls.save();
    } else {
      // Update roster for all existing classes in this cohort
      for (const cls of otherClasses) {
        const updatedStudents = students.map(newStudent => {
          const existing = cls.students.find(s => s.regNo === newStudent.regNo);
          if (existing) {
            const marks = existing.marks || Array(cls.subjects.length).fill("");
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
            marks: Array(cls.subjects.length).fill("")
          };
        });
        cls.students = updatedStudents;
        await cls.save();
      }
    }
    res.json({ message: "Roster saved successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// BULK CLONE & GENERATE CLASSES ACROSS SECTIONS AND EXAMS
router.post("/bulk-clone", async (req, res) => {
  try {
    const {
      source,
      targetExamsForSource = [],
      targetSections = []
    } = req.body;

    if (!source || !source.year || !source.semester || !source.section) {
      return res.status(400).json({ error: "Source class configuration is required." });
    }

    const prog = source.programme || "B.E";
    const dept = source.department || "CSE";
    const y = source.year;
    const sem = source.semester;
    const baseCourses = source.courseDetails || [];
    const sourceStudents = source.students || [];

    const getExamMarks = (exam) => {
      const ex = String(exam || "").toLowerCase();
      if (ex.includes("unit test")) return { passMark: 15, markPerSubject: 30 };
      if (ex === "cia - i" || ex === "cia - ii") return { passMark: 25, markPerSubject: 50 };
      if (ex === "cia - iii" || ex === "ese") return { passMark: 50, markPerSubject: 100 };
      return { passMark: 50, markPerSubject: 100 };
    };

    const results = [];

    const createOrUpdateClass = async (targetSec, targetExam, facultyMap = {}, isSourceSec = false) => {
      const className = `${prog}-${dept} - ${y}/${sem}/${targetSec} - ${targetExam}`;
      const yearSemSec = `${y}/${sem}/${targetSec}`;
      const { passMark, markPerSubject } = getExamMarks(targetExam);

      // Map courses and apply faculty overrides
      const mappedCourses = baseCourses.map(c => {
        const customFac = facultyMap[c.courseCode] !== undefined ? facultyMap[c.courseCode] : c.facultyName;
        return {
          courseCode: c.courseCode || "",
          courseName: c.courseName || "",
          shortName: c.shortName || "",
          facultyName: customFac || "",
          credits: c.credits !== undefined ? c.credits : 3
        };
      });
      const subjects = mappedCourses.map(c => c.courseCode || "");

      // Determine students roster
      let targetStudents = [];
      if (isSourceSec && sourceStudents.length > 0) {
        targetStudents = sourceStudents.map(s => ({
          regNo: s.regNo,
          name: s.name,
          gender: s.gender || "Boy",
          studentType: s.studentType || "Day Scholar",
          dob: s.dob || "",
          marks: (s.marks && s.marks.length === subjects.length) ? s.marks : Array(subjects.length).fill("")
        }));
      } else {
        // Load Master Roster for target cohort
        const cohortName = `${prog}-${dept} - ${yearSemSec}`;
        const rosterDoc = await Roster.findOne({ cohortName });
        if (rosterDoc && rosterDoc.students && rosterDoc.students.length > 0) {
          targetStudents = rosterDoc.students.map(s => ({
            regNo: s.regNo,
            name: s.name,
            gender: s.gender || "Boy",
            studentType: s.studentType || "Day Scholar",
            dob: s.dob || "",
            marks: Array(subjects.length).fill("")
          }));
        } else {
          // Fallback: check if any existing class with this yearSemSec has students
          const existingPeer = await ClassData.findOne({
            programme: prog,
            department: dept,
            yearSemSec,
            isDeleted: { $ne: true }
          });
          if (existingPeer && existingPeer.students && existingPeer.students.length > 0) {
            targetStudents = existingPeer.students.map(s => ({
              regNo: s.regNo,
              name: s.name,
              gender: s.gender || "Boy",
              studentType: s.studentType || "Day Scholar",
              dob: s.dob || "",
              marks: Array(subjects.length).fill("")
            }));
          }
        }
      }

      // Purge any deleted class with same name
      await ClassData.deleteOne({ className, isDeleted: true });

      let cls = await ClassData.findOne({ className });
      if (cls) {
        cls.subjects = subjects;
        cls.courseDetails = mappedCourses;
        cls.passMark = passMark;
        cls.markPerSubject = markPerSubject;
        cls.examName = targetExam;
        cls.targetPassPercentage = Number(source.targetPassPercentage) || 85;
        cls.date = source.date || cls.date || "";
        cls.department = dept;
        cls.yearSemSec = yearSemSec;
        cls.programme = prog;
        cls.isDeleted = false;
        if (source.eseGradingSystem) cls.eseGradingSystem = source.eseGradingSystem;

        if (cls.students && cls.students.length > 0 && targetStudents.length > 0) {
          const merged = targetStudents.map(newS => {
            const old = cls.students.find(s => s.regNo === newS.regNo);
            if (old) {
              return {
                ...newS,
                marks: (old.marks && old.marks.length === subjects.length) ? old.marks : Array(subjects.length).fill("")
              };
            }
            return newS;
          });
          cls.students = merged;
        } else if (targetStudents.length > 0) {
          cls.students = targetStudents;
        }

        await cls.save();
        results.push({ className, action: "updated", studentCount: cls.students?.length || 0 });
      } else {
        const newClass = new ClassData({
          className,
          subjects,
          courseDetails: mappedCourses,
          passMark,
          examName: targetExam,
          markPerSubject,
          students: targetStudents,
          targetPassPercentage: Number(source.targetPassPercentage) || 85,
          date: source.date || "",
          department: dept,
          yearSemSec,
          programme: prog,
          allowEditing: true,
          eseGradingSystem: source.eseGradingSystem || "System 2"
        });
        await newClass.save();
        results.push({ className, action: "created", studentCount: targetStudents.length });
      }
    };

    // 1. Generate target exams for SOURCE section
    for (const ex of targetExamsForSource) {
      if (ex === source.examName) continue;
      await createOrUpdateClass(source.section, ex, {}, true);
    }

    // 2. Generate target sections
    for (const secConfig of targetSections) {
      const sec = secConfig.section;
      if (!sec) continue;
      const examsToRun = secConfig.exams && secConfig.exams.length > 0 ? secConfig.exams : [source.examName];
      const facMap = secConfig.facultyMap || {};
      for (const ex of examsToRun) {
        await createOrUpdateClass(sec, ex, facMap, false);
      }
    }

    return res.json({
      success: true,
      message: `Successfully generated and synchronized ${results.length} class(es)!`,
      results
    });
  } catch (err) {
    console.error("bulk-clone error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// CREATE OR UPDATE A CLASS (Admin Panel Data Setup)
router.post("/", async (req, res) => {
  try {
    const { className, subjects, passMark, examName, markPerSubject, students, courseDetails, targetPassPercentage, date, department, yearSemSec, programme, allowEditing, editingStartDate, editingEndDate, editingStartTime, editingEndTime, propagateRoster, propagateToYearSem, eseGradingSystem } = req.body;

    // Purge any deleted class with the same name to prevent key collisions
    await ClassData.deleteOne({ className, isDeleted: true });

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
      if (eseGradingSystem !== undefined) cls.eseGradingSystem = eseGradingSystem;
      
      // Preserve existing marks for students that are kept, add new ones empty
      const updatedStudents = students.map(newStudent => {
        const existing = cls.students.find(s => s.regNo === newStudent.regNo);
        if (existing) {
          // ensure marks array is same length as new subjects
          const marks = (newStudent.marks && newStudent.marks.length > 0) ? newStudent.marks : (existing.marks || Array(subjects.length).fill(""));
          return { ...existing.toObject(), name: newStudent.name, regNo: newStudent.regNo, gender: newStudent.gender || existing.gender, studentType: newStudent.studentType || existing.studentType, dob: newStudent.dob !== undefined ? newStudent.dob : existing.dob, marks: marks };
        }
        return { ...newStudent, marks: (newStudent.marks && newStudent.marks.length > 0) ? newStudent.marks : Array(subjects.length).fill("") };
      });
      cls.students = updatedStudents;
      await cls.save();

      if (propagateRoster) {
        await propagateRosterToCohort(cls, students, courseDetails);
      }

      if (propagateToYearSem) {
        const yearSemPrefix = cls.yearSemSec.split('/').slice(0, 2).join('/');
        const otherYearSemClasses = await ClassData.find({
          programme: cls.programme,
          department: cls.department,
          examName: cls.examName,
          yearSemSec: { $regex: `^${yearSemPrefix}/` },
          _id: { $ne: cls._id },
          isDeleted: { $ne: true }
        });
        for (const otherCls of otherYearSemClasses) {
          if (courseDetails && courseDetails.length > 0) {
            otherCls.courseDetails = courseDetails.map(newCd => {
              const existingCd = otherCls.courseDetails?.find(oldCd => oldCd.courseCode === newCd.courseCode);
              return {
                ...newCd,
                facultyName: existingCd ? existingCd.facultyName : ""
              };
            });
            otherCls.subjects = courseDetails.map(cd => cd.courseCode || "");
          }
          if (date !== undefined) otherCls.date = date;
          if (eseGradingSystem !== undefined) otherCls.eseGradingSystem = eseGradingSystem;
          await otherCls.save();
        }
      }

      return res.json(cls);
    } else {
      // Create new
      const sList = students.map(s => ({
        ...s,
        marks: (s.marks && s.marks.length > 0) ? s.marks : Array(subjects.length).fill("")
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
        editingEndTime: editingEndTime || "",
        eseGradingSystem: eseGradingSystem || "System 2"
      });
      await newClass.save();

      if (propagateRoster) {
        await propagateRosterToCohort(newClass, students, courseDetails);
      }

      if (propagateToYearSem) {
        const yearSemPrefix = newClass.yearSemSec.split('/').slice(0, 2).join('/');
        const otherYearSemClasses = await ClassData.find({
          programme: newClass.programme,
          department: newClass.department,
          examName: newClass.examName,
          yearSemSec: { $regex: `^${yearSemPrefix}/` },
          _id: { $ne: newClass._id },
          isDeleted: { $ne: true }
        });
        for (const otherCls of otherYearSemClasses) {
          if (courseDetails && courseDetails.length > 0) {
            otherCls.courseDetails = courseDetails.map(newCd => {
              const existingCd = otherCls.courseDetails?.find(oldCd => oldCd.courseCode === newCd.courseCode);
              return {
                ...newCd,
                facultyName: existingCd ? existingCd.facultyName : ""
              };
            });
            otherCls.subjects = courseDetails.map(cd => cd.courseCode || "");
          }
          if (date !== undefined) otherCls.date = date;
          if (eseGradingSystem !== undefined) otherCls.eseGradingSystem = eseGradingSystem;
          await otherCls.save();
        }
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
    const { students, isAdmin } = req.body; 
    // students array with regNo, name, and marks array
    const cls = await ClassData.findOne({ className: req.params.className });
    if (!cls) return res.status(404).json({ error: "Class not found" });

    if (!isAdmin && cls.allowEditing === false) {
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

    if (!isAdmin && cls.editingStartDate) {
      const startLimit = cls.editingStartDate + "T" + (cls.editingStartTime || "00:00");
      if (todayStr < startLimit) {
        return res.status(403).json({ error: `Mark entry is only allowed starting from ${formatDate(cls.editingStartDate)} ${cls.editingStartTime || "00:00"}.` });
      }
    }
    if (!isAdmin && cls.editingEndDate) {
      const endLimit = cls.editingEndDate + "T" + (cls.editingEndTime || "23:59");
      if (todayStr > endLimit) {
        return res.status(403).json({ error: `Mark entry has expired on ${formatDate(cls.editingEndDate)} ${cls.editingEndTime || "23:59"}.` });
      }
    }

    cls.students = recalculateClassStudents(cls, students);
    await cls.save();
    
    res.json(cls);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ADMIN ONLY: CLEAR MARKS FOR A SINGLE SUBJECT COLUMN (all / absent / fail)
router.post("/:className/clear-subject-marks", requireStrictAdmin, async (req, res) => {
  try {
    const { subjectIndex, mode = "all" } = req.body;
    const cls = await ClassData.findOne({ className: req.params.className, isDeleted: { $ne: true } });
    if (!cls) return res.status(404).json({ error: "Class not found." });

    const idx = Number(subjectIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= (cls.subjects || []).length) {
      return res.status(400).json({ error: "Invalid subject selection." });
    }
    if (!["all", "absent", "fail"].includes(mode)) {
      return res.status(400).json({ error: "Invalid clear mode specified." });
    }

    const isESE = cls.examName === "ESE";
    const subjectCount = (cls.subjects || []).length;
    const backupMarksByRegNo = {};
    let clearedCount = 0;

    const updatedStudents = (cls.students || []).map(s => {
      const studentObj = typeof s.toObject === "function" ? s.toObject() : { ...s };
      const marks = Array.isArray(studentObj.marks) ? [...studentObj.marks] : [];
      while (marks.length < subjectCount) marks.push("");

      const currentVal = marks[idx];
      if (shouldClearMarkValue(currentVal, isESE, cls.passMark, mode)) {
        if (studentObj.regNo) {
          backupMarksByRegNo[studentObj.regNo] = currentVal;
        }
        marks[idx] = "";
        clearedCount++;
      }
      return { ...studentObj, marks };
    });

    cls.students = recalculateClassStudents(cls, updatedStudents);
    await cls.save();

    res.json({
      success: true,
      clearedCount,
      mode,
      subjectIndex: idx,
      subjectCode: cls.subjects[idx],
      backupMarksByRegNo,
      classData: cls
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ADMIN ONLY: RESTORE MARKS FOR A SINGLE SUBJECT COLUMN (1-Click Undo)
router.post("/:className/restore-subject-marks", requireStrictAdmin, async (req, res) => {
  try {
    const { subjectIndex, marksByRegNo } = req.body;
    const cls = await ClassData.findOne({ className: req.params.className, isDeleted: { $ne: true } });
    if (!cls) return res.status(404).json({ error: "Class not found." });

    const idx = Number(subjectIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= (cls.subjects || []).length) {
      return res.status(400).json({ error: "Invalid subject selection." });
    }
    if (!marksByRegNo || typeof marksByRegNo !== "object") {
      return res.status(400).json({ error: "Backup marks map is required." });
    }

    const subjectCount = (cls.subjects || []).length;
    let restoredCount = 0;

    const updatedStudents = (cls.students || []).map(s => {
      const studentObj = typeof s.toObject === "function" ? s.toObject() : { ...s };
      const marks = Array.isArray(studentObj.marks) ? [...studentObj.marks] : [];
      while (marks.length < subjectCount) marks.push("");

      if (studentObj.regNo && Object.prototype.hasOwnProperty.call(marksByRegNo, studentObj.regNo)) {
        marks[idx] = marksByRegNo[studentObj.regNo];
        restoredCount++;
      }
      return { ...studentObj, marks };
    });

    cls.students = recalculateClassStudents(cls, updatedStudents);
    await cls.save();

    res.json({
      success: true,
      restoredCount,
      subjectIndex: idx,
      classData: cls
    });
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
    const cls = await ClassData.findOne({ className: req.params.className, isDeleted: { $ne: true } });
    if (!cls) return res.status(404).json({ error: "Class not found" });
    res.json(cls);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SAVE ATTENDANCE
router.post("/:className/attendance", async (req, res) => {
  try {
    const { attendanceMap } = req.body;
    const cls = await ClassData.findOne({ className: req.params.className });
    if (!cls) return res.status(404).json({ error: "Class not found" });

    cls.students.forEach(student => {
      if (attendanceMap[student.regNo] !== undefined) {
        student.attendance = attendanceMap[student.regNo];
      }
    });

    await cls.save();
    res.json({ message: "Attendance saved successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE REPORT SETTINGS FOR A CLASS
router.put("/:id/report-settings", async (req, res) => {
  try {
    const { iqacPrefix, academicYearText, actionTakenSubjects } = req.body;
    const cls = await ClassData.findById(req.params.id);
    if (!cls) return res.status(404).json({ error: "Class not found" });

    if (iqacPrefix !== undefined) cls.iqacPrefix = iqacPrefix;
    if (academicYearText !== undefined) cls.academicYearText = academicYearText;
    if (actionTakenSubjects !== undefined) cls.actionTakenSubjects = actionTakenSubjects;

    await cls.save();
    res.json({ message: "Report settings updated successfully", class: cls });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
