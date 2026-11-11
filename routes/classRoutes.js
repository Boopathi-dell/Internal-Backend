const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const ClassData = require("../models/Class");
const Roster = require("../models/Roster");
const { SectionStaffMapping } = require("../models/CohortCourse");

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

// Remap existing marks from old subject codes to new subject codes so changing/adding subjects never misaligns or copies across exams
const remapStudentMarksBySubject = (oldSubjects = [], newSubjects = [], oldMarks = []) => {
  const normalizedOld = (oldSubjects || []).map(c => String(c || "").trim().toUpperCase());
  const normalizedNew = (newSubjects || []).map(c => String(c || "").trim().toUpperCase());
  const sourceMarks = Array.isArray(oldMarks) ? oldMarks : [];

  if (normalizedNew.length === 0) return [];
  if (
    normalizedOld.length === normalizedNew.length &&
    normalizedOld.every((code, idx) => code && code === normalizedNew[idx])
  ) {
    return normalizedNew.map((_, idx) => (sourceMarks[idx] !== undefined ? sourceMarks[idx] : ""));
  }

  return normalizedNew.map((newCode) => {
    if (!newCode) return "";
    const oldIdx = normalizedOld.indexOf(newCode);
    return (oldIdx !== -1 && sourceMarks[oldIdx] !== undefined) ? sourceMarks[oldIdx] : "";
  });
};

// Merge incoming roster entries while preserving existing marks arrays without Mongoose __v version conflicts
const mergeCohortStudents = (
  existingStudents = [],
  incomingStudents = [],
  subjectCount = 0,
  { acceptIncomingMarks = false, existingSubjects = null, targetSubjects = null } = {}
) => {
  return (incomingStudents || []).map(newStudent => {
    const incomingObj = typeof newStudent.toObject === "function" ? newStudent.toObject() : { ...newStudent };
    const existing = existingStudents.find(s => s.regNo === incomingObj.regNo);
    const emptyMarks = Array(subjectCount).fill("");
    if (existing) {
      const existingObj = typeof existing.toObject === "function" ? existing.toObject() : { ...existing };
      let marks;
      if (acceptIncomingMarks && incomingObj.marks && incomingObj.marks.length > 0) {
        marks = incomingObj.marks;
      } else if (Array.isArray(existingSubjects) && Array.isArray(targetSubjects)) {
        marks = remapStudentMarksBySubject(existingSubjects, targetSubjects, existingObj.marks);
      } else {
        marks = existingObj.marks || emptyMarks;
      }
      const dob = incomingObj.dob !== undefined && incomingObj.dob !== "" ? incomingObj.dob : existingObj.dob;
      return {
        ...existingObj,
        name: incomingObj.name,
        regNo: incomingObj.regNo,
        gender: incomingObj.gender || existingObj.gender,
        studentType: incomingObj.studentType || existingObj.studentType,
        dob,
        marks
      };
    }
    return {
      ...incomingObj,
      marks: (acceptIncomingMarks && incomingObj.marks && incomingObj.marks.length > 0) ? incomingObj.marks : emptyMarks
    };
  });
};

// Create a new class document safely; fall back to atomic update if a concurrent request creates it first
const createClassSafely = async (docFields) => {
  try {
    const doc = new ClassData(docFields);
    return await doc.save();
  } catch (err) {
    if (err && err.code === 11000) {
      return await ClassData.findOneAndUpdate(
        { className: docFields.className },
        { $set: { ...docFields, isDeleted: false } },
        { new: true }
      );
    }
    throw err;
  }
};

// Propagate student roster ONLY across all exams for the same section (never overwrite another exam's subjects or marks)
const propagateRosterToCohort = async (baseClass, roster) => {
  const otherClasses = await ClassData.find({
    programme: baseClass.programme,
    department: baseClass.department,
    yearSemSec: baseClass.yearSemSec,
    isDeleted: { $ne: true },
    _id: { $ne: baseClass._id }
  });

  for (const otherCls of otherClasses) {
    const updateFields = {
      students: mergeCohortStudents(otherCls.students, roster, (otherCls.subjects || []).length)
    };
    await ClassData.findByIdAndUpdate(otherCls._id, { $set: updateFields }, { new: true });
  }
};

// Propagate subject structure, date, and grading system across sections of the same Year/Sem and exam
const propagateYearSemSettings = async (baseClass, courseDetails, date, eseGradingSystem) => {
  const yearSemPrefix = baseClass.yearSemSec.split('/').slice(0, 2).join('/');
  const otherYearSemClasses = await ClassData.find({
    programme: baseClass.programme,
    department: baseClass.department,
    examName: baseClass.examName,
    yearSemSec: { $regex: `^${yearSemPrefix}/` },
    _id: { $ne: baseClass._id },
    isDeleted: { $ne: true }
  });

  for (const otherCls of otherYearSemClasses) {
    const updateFields = {};
    if (courseDetails && courseDetails.length > 0) {
      updateFields.courseDetails = courseDetails.map(newCd => {
        const existingCd = otherCls.courseDetails?.find(oldCd => oldCd.courseCode === newCd.courseCode);
        return {
          ...newCd,
          facultyName: existingCd ? existingCd.facultyName : ""
        };
      });
      updateFields.subjects = courseDetails.map(cd => cd.courseCode || "");
    }
    if (date !== undefined) updateFields.date = date;
    if (eseGradingSystem !== undefined) updateFields.eseGradingSystem = eseGradingSystem;

    if (Object.keys(updateFields).length > 0) {
      await ClassData.findByIdAndUpdate(otherCls._id, { $set: updateFields }, { new: true });
    }
  }
};


// GET ALL CLASSES
router.get("/migrate/assignments", async (req, res) => {
  try {
    const classes = await ClassData.find({ examName: /Assignment/i });
    let count = 0;
    for (let c of classes) {
      await ClassData.findByIdAndUpdate(c._id, {
        $set: {
          examName: c.examName.replace(/Assignment/ig, "Unit Test"),
          className: c.className.replace(/Assignment/ig, "Unit Test")
        }
      });
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
    res.set("Cache-Control", "no-store");
    const { deletedOnly, department, yearSemSec, summary } = req.query;
    
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

    let dbQuery = ClassData.find(query).sort({ updatedAt: -1, _id: -1 });
    if (summary === "true") {
      dbQuery = dbQuery.select("-students -semesterProgress").lean();
    }

    const classes = await dbQuery;
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
      // Create or update base roster class atomically to hold the students
      const baseClassName = `${programme}-${department} - ${yearSemSec.replace(/\//g, '/')} - Base Roster`;
      await ClassData.findOneAndUpdate(
        { className: baseClassName },
        {
          $set: {
            className: baseClassName,
            examName: "Base Roster",
            passMark: 0,
            markPerSubject: 0,
            students,
            department,
            yearSemSec,
            programme,
            isDeleted: false
          }
        },
        { upsert: true, new: true }
      );
    } else {
      // Update roster for all existing classes in this cohort atomically (avoids Mongoose __v VersionError)
      for (const cls of otherClasses) {
        const updatedStudents = mergeCohortStudents(cls.students, students, (cls.subjects || []).length);
        await ClassData.findByIdAndUpdate(
          cls._id,
          { $set: { students: updatedStudents } },
          { new: true }
        );
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
      includeSourceCurrentExam = true,
      targetExamsForSource = [],
      targetSections = []
    } = req.body;

    if (!source || !source.year || !source.semester || !source.section) {
      return res.status(400).json({ error: "Source class configuration is required." });
    }

    const prog = String(source.programme || "B.E").trim();
    const dept = String(source.department || "CSE").trim();
    const y = String(source.year).trim();
    const sem = String(source.semester).trim();
    const sourceSec = String(source.section).trim();
    const sourceExam = String(source.examName || "").trim();
    const baseCourses = (source.courseDetails || []).map(c => ({
      courseCode: String(c.courseCode || "").trim(),
      courseName: String(c.courseName || "").trim(),
      shortName: String(c.shortName || "").trim(),
      facultyName: String(c.facultyName || "").trim(),
      credits: c.credits !== undefined ? c.credits : 3
    }));
    const sourceStudents = source.students || [];

    const getExamMarks = (exam) => {
      const exTrim = String(exam || "").trim();
      const ex = exTrim.toLowerCase();
      if (sourceExam && ex === sourceExam.toLowerCase() &&
          source.passMark !== undefined && source.passMark !== "" &&
          source.markPerSubject !== undefined && source.markPerSubject !== "") {
        return {
          passMark: Number(source.passMark) || 0,
          markPerSubject: Number(source.markPerSubject) || 0
        };
      }
      if (ex.includes("unit test")) return { passMark: 15, markPerSubject: 30 };
      if (ex === "cia - i" || ex === "cia - ii" || ex === "cia i" || ex === "cia ii") return { passMark: 25, markPerSubject: 50 };
      if (ex === "cia - iii" || ex === "cia iii" || ex === "ese" || ex.includes("model")) return { passMark: 50, markPerSubject: 100 };
      if (ex === "mkc") return { passMark: 3, markPerSubject: 5 };
      return { passMark: 50, markPerSubject: 100 };
    };

    const results = [];

    const createOrUpdateClass = async (targetSecRaw, targetExamRaw, facultyMap = {}, isSourceSec = false, preserveExistingSectionFaculty = false) => {
      const targetSec = String(targetSecRaw || "").trim();
      const targetExam = String(targetExamRaw || "").trim();
      if (!targetSec || !targetExam) return;

      const className = `${prog}-${dept} - ${y}/${sem}/${targetSec} - ${targetExam}`;
      const yearSemSec = `${y}/${sem}/${targetSec}`;
      const { passMark, markPerSubject } = getExamMarks(targetExam);

      // Load peer class & master SectionStaffMapping for this cohort once if we need its roster or mapped faculty
      const cohortKeyForSec = `${prog}-${dept} - ${yearSemSec}`;
      const [existingPeerForCohort, staffMappingDoc] = await Promise.all([
        ClassData.findOne({
          programme: prog,
          department: dept,
          yearSemSec,
          isDeleted: { $ne: true }
        }),
        SectionStaffMapping.findOne({ cohortName: cohortKeyForSec })
      ]);

      // Map courses and apply explicit faculty overrides -> Master Section Staff Mapping -> peer/source fallback
      const mappedCourses = baseCourses.map(c => {
        const codeUpper = c.courseCode.toUpperCase();
        const masterStaffEntry = (staffMappingDoc?.staffAssignments || []).find(
          sa => String(sa.courseCode || "").trim().toUpperCase() === codeUpper
        );
        const masterStaffName = masterStaffEntry ? String(masterStaffEntry.facultyName || "").trim() : "";

        let resolvedFac = "";
        if (Object.prototype.hasOwnProperty.call(facultyMap, c.courseCode)) {
          resolvedFac = String(facultyMap[c.courseCode] || "").trim();
        } else if (masterStaffName) {
          resolvedFac = masterStaffName;
        } else if (isSourceSec) {
          resolvedFac = c.facultyName || "";
        } else if (preserveExistingSectionFaculty && existingPeerForCohort?.courseDetails) {
          const peerCd = existingPeerForCohort.courseDetails.find(
            pc => String(pc.courseCode || "").trim().toUpperCase() === codeUpper
          );
          resolvedFac = peerCd ? String(peerCd.facultyName || "").trim() : "";
        } else {
          resolvedFac = c.facultyName || "";
        }
        return {
          courseCode: c.courseCode,
          courseName: c.courseName,
          shortName: c.shortName,
          facultyName: resolvedFac,
          credits: c.credits !== undefined ? c.credits : 3
        };
      });
      const subjects = mappedCourses.map(c => c.courseCode || "");

      // Determine students roster (prefers Master Roster for target section; preserves source students for source section)
      // IMPORTANT: Never copy marks across DIFFERENT exams (e.g. LAB OBSERVATION MARKS -> CIA - I)
      const isSameExamAsSource = Boolean(sourceExam && targetExam.toLowerCase() === sourceExam.toLowerCase());
      let targetStudents = [];
      if (isSourceSec && sourceStudents.length > 0) {
        targetStudents = sourceStudents.map(s => ({
          regNo: s.regNo,
          name: s.name,
          gender: s.gender || "Boy",
          studentType: s.studentType || "Day Scholar",
          dob: s.dob || "",
          marks: (isSameExamAsSource && s.marks && s.marks.length === subjects.length) ? s.marks : Array(subjects.length).fill("")
        }));
      } else {
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
        } else if (existingPeerForCohort && existingPeerForCohort.students && existingPeerForCohort.students.length > 0) {
          targetStudents = existingPeerForCohort.students.map(s => ({
            regNo: s.regNo,
            name: s.name,
            gender: s.gender || "Boy",
            studentType: s.studentType || "Day Scholar",
            dob: s.dob || "",
            marks: Array(subjects.length).fill("")
          }));
        }
      }

      // Purge any deleted class with same name
      await ClassData.deleteOne({ className, isDeleted: true });

      let cls = await ClassData.findOne({ className });
      if (cls) {
        const updateFields = {
          subjects,
          courseDetails: mappedCourses,
          passMark,
          markPerSubject,
          examName: targetExam,
          targetPassPercentage: Number(source.targetPassPercentage) || 85,
          date: source.date || cls.date || "",
          department: dept,
          yearSemSec,
          programme: prog,
          isDeleted: false
        };
        if (source.eseGradingSystem) updateFields.eseGradingSystem = source.eseGradingSystem;

        if (cls.students && cls.students.length > 0 && targetStudents.length > 0) {
          updateFields.students = targetStudents.map(newS => {
            const old = cls.students.find(s => s.regNo === newS.regNo);
            if (old) {
              return {
                ...newS,
                marks: remapStudentMarksBySubject(cls.subjects || [], subjects, old.marks || [])
              };
            }
            return newS;
          });
        } else if (targetStudents.length > 0) {
          updateFields.students = targetStudents;
        }

        const savedCls = await ClassData.findByIdAndUpdate(
          cls._id,
          { $set: updateFields },
          { new: true }
        );
        results.push({ className, section: targetSec, examName: targetExam, action: "updated", studentCount: savedCls?.students?.length || 0 });
      } else {
        await createClassSafely({
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
        results.push({ className, section: targetSec, examName: targetExam, action: "created", studentCount: targetStudents.length });
      }
    };

    // 1. Save/update current exam on source section if requested
    if (includeSourceCurrentExam && sourceExam) {
      await createOrUpdateClass(sourceSec, sourceExam, {}, true, false);
    }

    // 2. Generate other target exams for SOURCE section
    for (const ex of targetExamsForSource) {
      if (String(ex || "").trim() === sourceExam) continue;
      await createOrUpdateClass(sourceSec, ex, {}, true, false);
    }

    // 3. Generate target sections (each receives its own Master Roster + faculty mapping)
    for (const secConfig of targetSections) {
      const sec = String(secConfig.section || "").trim();
      if (!sec) continue;
      const examsToRun = secConfig.exams && secConfig.exams.length > 0 ? secConfig.exams : [sourceExam];
      const facMap = secConfig.facultyMap || {};
      const preserveFac = Boolean(secConfig.preserveExistingSectionFaculty);
      for (const ex of examsToRun) {
        await createOrUpdateClass(sec, ex, facMap, sec === sourceSec, preserveFac);
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

    const existingCls = await ClassData.findOne({ className });
    let savedClass;

    if (existingCls) {
      // Update existing atomically via $set; preserve DB marks aligned by course code (never overwrite from Class Setup state)
      const updateFields = {
        subjects,
        passMark,
        examName,
        markPerSubject,
        isDeleted: false,
        students: mergeCohortStudents(existingCls.students, students, subjects.length, {
          acceptIncomingMarks: false,
          existingSubjects: existingCls.subjects || [],
          targetSubjects: subjects || []
        })
      };
      if (courseDetails) updateFields.courseDetails = courseDetails;
      if (targetPassPercentage) updateFields.targetPassPercentage = targetPassPercentage;
      if (date !== undefined) updateFields.date = date;
      if (department !== undefined) updateFields.department = department;
      if (yearSemSec !== undefined) updateFields.yearSemSec = yearSemSec;
      if (programme !== undefined) updateFields.programme = programme;
      if (allowEditing !== undefined) updateFields.allowEditing = allowEditing;
      if (editingStartDate !== undefined) updateFields.editingStartDate = editingStartDate;
      if (editingEndDate !== undefined) updateFields.editingEndDate = editingEndDate;
      if (editingStartTime !== undefined) updateFields.editingStartTime = editingStartTime;
      if (editingEndTime !== undefined) updateFields.editingEndTime = editingEndTime;
      if (eseGradingSystem !== undefined) updateFields.eseGradingSystem = eseGradingSystem;

      savedClass = await ClassData.findByIdAndUpdate(
        existingCls._id,
        { $set: updateFields },
        { new: true }
      );
    } else {
      // Create new safely; always initialize fresh empty marks so no previous exam's marks leak in
      const sList = (students || []).map(s => ({
        regNo: s.regNo,
        name: s.name,
        dob: s.dob || "",
        gender: s.gender || "Boy",
        studentType: s.studentType || "Day Scholar",
        marks: Array(subjects.length).fill("")
      }));
      savedClass = await createClassSafely({
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
    }

    if (propagateRoster && savedClass) {
      await propagateRosterToCohort(savedClass, students);
    }

    if (propagateToYearSem && savedClass) {
      await propagateYearSemSettings(savedClass, courseDetails, date, eseGradingSystem);
    }

    return res.json(savedClass);
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

    const recalculatedStudents = recalculateClassStudents(cls, students);
    const updatedCls = await ClassData.findByIdAndUpdate(
      cls._id,
      { $set: { students: recalculatedStudents } },
      { new: true }
    );
    
    res.json(updatedCls);
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

    const recalculatedStudents = recalculateClassStudents(cls, updatedStudents);
    const updatedCls = await ClassData.findByIdAndUpdate(
      cls._id,
      { $set: { students: recalculatedStudents } },
      { new: true }
    );

    res.json({
      success: true,
      clearedCount,
      mode,
      subjectIndex: idx,
      subjectCode: cls.subjects[idx],
      backupMarksByRegNo,
      classData: updatedCls
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

    const recalculatedStudents = recalculateClassStudents(cls, updatedStudents);
    const updatedCls = await ClassData.findByIdAndUpdate(
      cls._id,
      { $set: { students: recalculatedStudents } },
      { new: true }
    );

    res.json({
      success: true,
      restoredCount,
      subjectIndex: idx,
      classData: updatedCls
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

    const updatedCls = await ClassData.findByIdAndUpdate(
      cls._id,
      { $set: { semesterProgress } },
      { new: true }
    );
    res.json(updatedCls);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET A SINGLE CLASS (For Entry, Analysis, Rank)
router.get("/:className", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
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

    const updatedStudents = (cls.students || []).map(student => {
      const studentObj = typeof student.toObject === "function" ? student.toObject() : { ...student };
      if (attendanceMap && attendanceMap[studentObj.regNo] !== undefined) {
        studentObj.attendance = attendanceMap[studentObj.regNo];
      }
      return studentObj;
    });

    await ClassData.findByIdAndUpdate(
      cls._id,
      { $set: { students: updatedStudents } },
      { new: true }
    );
    res.json({ message: "Attendance saved successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE REPORT SETTINGS FOR A CLASS
router.put("/:id/report-settings", async (req, res) => {
  try {
    const { iqacPrefix, academicYearText, actionTakenSubjects } = req.body;
    const updateFields = {};
    if (iqacPrefix !== undefined) updateFields.iqacPrefix = iqacPrefix;
    if (academicYearText !== undefined) updateFields.academicYearText = academicYearText;
    if (actionTakenSubjects !== undefined) updateFields.actionTakenSubjects = actionTakenSubjects;

    const cls = await ClassData.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true }
    );
    if (!cls) return res.status(404).json({ error: "Class not found" });

    res.json({ message: "Report settings updated successfully", class: cls });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
