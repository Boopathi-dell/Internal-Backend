const express = require("express");
const ClassData = require("../models/Class");
const { CohortSubjectMaster, SectionStaffMapping } = require("../models/CohortCourse");

const router = express.Router();

const escapeRegex = (str) => String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildCohortKey = (programme = "B.E", department = "CSE", year = "", semester = "") =>
  `${String(programme).trim()}-${String(department).trim()} - ${String(year).trim()}/${String(semester).trim()}`;

const buildSectionCohortName = (programme = "B.E", department = "CSE", year = "", semester = "", section = "") =>
  `${buildCohortKey(programme, department, year, semester)}/${String(section).trim()}`;

const buildFilterQuery = ({ programme, department, year, semester, section }) => {
  const query = {};
  if (programme) query.programme = String(programme).trim();
  if (department) query.department = String(department).trim();
  if (year) query.year = String(year).trim();
  if (semester) query.semester = String(semester).trim();
  if (section) query.section = String(section).trim();
  return query;
};

// Update matching subjects' metadata/faculty across existing non-deleted exam models atomically without touching marks
const syncCoursesAcrossClasses = async (classes = [], masterSubjectsByCode = new Map(), staffByCode = null) => {
  let syncedCount = 0;

  for (const cls of classes) {
    const existingDetails = Array.isArray(cls.courseDetails) ? cls.courseDetails : [];
    if (existingDetails.length === 0) continue;

    let changed = false;
    const updatedDetails = existingDetails.map(cd => {
      const cdObj = typeof cd.toObject === "function" ? cd.toObject() : { ...cd };
      const codeKey = String(cdObj.courseCode || "").trim().toUpperCase();
      if (!codeKey) return cdObj;

      const masterItem = masterSubjectsByCode.get(codeKey);
      const next = { ...cdObj };

      if (masterItem) {
        if (masterItem.courseName && next.courseName !== masterItem.courseName) {
          next.courseName = masterItem.courseName;
          changed = true;
        }
        if (masterItem.shortName !== undefined && next.shortName !== masterItem.shortName) {
          next.shortName = masterItem.shortName;
          changed = true;
        }
        if (masterItem.credits !== undefined && Number(next.credits) !== Number(masterItem.credits)) {
          next.credits = Number(masterItem.credits);
          changed = true;
        }
      }

      if (staffByCode && staffByCode.has(codeKey)) {
        const mappedFaculty = staffByCode.get(codeKey);
        if ((next.facultyName || "") !== mappedFaculty) {
          next.facultyName = mappedFaculty;
          changed = true;
        }
      }

      return next;
    });

    if (changed) {
      await ClassData.findByIdAndUpdate(
        cls._id,
        { $set: { courseDetails: updatedDetails } },
        { new: true }
      );
      syncedCount++;
    }
  }

  return syncedCount;
};

// GET all or filtered Year & Semester Subject Master records
router.get("/subjects", async (req, res) => {
  try {
    const list = await CohortSubjectMaster.find(buildFilterQuery(req.query)).sort({ year: 1, semester: 1 });
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SAVE / UPDATE Year & Semester Subjects and optionally sync subject metadata across existing exam models
router.post("/subjects", async (req, res) => {
  try {
    const {
      programme = "B.E",
      department = "CSE",
      year,
      semester,
      subjects = [],
      syncToExistingClasses = true
    } = req.body;

    if (!year || !semester) {
      return res.status(400).json({ error: "Year and Semester are required." });
    }

    const prog = String(programme || "B.E").trim();
    const dept = String(department || "CSE").trim();
    const yr = String(year).trim();
    const sem = String(semester).trim();
    const cohortKey = buildCohortKey(prog, dept, yr, sem);

    const normalizedSubjects = (subjects || [])
      .filter(s => String(s?.courseCode || "").trim() || String(s?.courseName || "").trim())
      .map(s => ({
        courseCode: String(s.courseCode || "").trim(),
        courseName: String(s.courseName || "").trim(),
        shortName: String(s.shortName || "").trim(),
        credits: s.credits !== undefined && s.credits !== "" ? Number(s.credits) : 3,
        category: ["Theory", "Lab", "Other"].includes(s.category) ? s.category : "Theory"
      }));

    const saved = await CohortSubjectMaster.findOneAndUpdate(
      { cohortKey },
      {
        $set: {
          cohortKey,
          programme: prog,
          department: dept,
          year: yr,
          semester: sem,
          subjects: normalizedSubjects
        }
      },
      { upsert: true, new: true }
    );

    let syncedClassCount = 0;
    if (syncToExistingClasses && normalizedSubjects.length > 0) {
      const masterMap = new Map();
      normalizedSubjects.forEach(s => {
        const key = s.courseCode.toUpperCase();
        if (key) masterMap.set(key, s);
      });

      const matchingClasses = await ClassData.find({
        programme: prog,
        department: dept,
        yearSemSec: { $regex: `^${escapeRegex(`${yr}/${sem}/`)}` },
        isDeleted: { $ne: true }
      });

      syncedClassCount = await syncCoursesAcrossClasses(matchingClasses, masterMap, null);
    }

    res.json({
      message: syncedClassCount > 0
        ? `Subjects saved and synced across ${syncedClassCount} exam model(s)!`
        : "Subjects saved successfully!",
      subjectMaster: saved,
      syncedClassCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET all or filtered Section Staff Mappings
router.get("/staff-mappings", async (req, res) => {
  try {
    const list = await SectionStaffMapping.find(buildFilterQuery(req.query)).sort({ year: 1, semester: 1, section: 1 });
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SAVE / UPDATE Section Staff Mapping and auto-sync staff names to all exam models of that section
router.post("/staff-mappings", async (req, res) => {
  try {
    const {
      programme = "B.E",
      department = "CSE",
      year,
      semester,
      section,
      staffAssignments = [],
      syncToExistingClasses = true
    } = req.body;

    if (!year || !semester || !section) {
      return res.status(400).json({ error: "Year, Semester, and Section are required." });
    }

    const prog = String(programme || "B.E").trim();
    const dept = String(department || "CSE").trim();
    const yr = String(year).trim();
    const sem = String(semester).trim();
    const sec = String(section).trim();
    const cohortName = buildSectionCohortName(prog, dept, yr, sem, sec);
    const cohortKey = buildCohortKey(prog, dept, yr, sem);

    const normalizedAssignments = (staffAssignments || [])
      .filter(a => String(a?.courseCode || "").trim())
      .map(a => ({
        courseCode: String(a.courseCode || "").trim(),
        facultyName: String(a.facultyName || "").trim()
      }));

    const saved = await SectionStaffMapping.findOneAndUpdate(
      { cohortName },
      {
        $set: {
          cohortName,
          programme: prog,
          department: dept,
          year: yr,
          semester: sem,
          section: sec,
          staffAssignments: normalizedAssignments
        }
      },
      { upsert: true, new: true }
    );

    let syncedClassCount = 0;
    if (syncToExistingClasses) {
      const subjectDoc = await CohortSubjectMaster.findOne({ cohortKey });
      const masterMap = new Map();
      (subjectDoc?.subjects || []).forEach(s => {
        const key = String(s.courseCode || "").trim().toUpperCase();
        if (key) masterMap.set(key, s);
      });

      const staffMap = new Map();
      normalizedAssignments.forEach(a => {
        staffMap.set(a.courseCode.toUpperCase(), a.facultyName);
      });

      const sectionClasses = await ClassData.find({
        programme: prog,
        department: dept,
        yearSemSec: `${yr}/${sem}/${sec}`,
        isDeleted: { $ne: true }
      });

      syncedClassCount = await syncCoursesAcrossClasses(sectionClasses, masterMap, staffMap);
    }

    res.json({
      message: syncedClassCount > 0
        ? `Staff mapping saved and updated across ${syncedClassCount} exam model(s) for Sec ${sec}!`
        : `Staff mapping saved for Sec ${sec}!`,
      mapping: saved,
      syncedClassCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
