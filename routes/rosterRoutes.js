const express = require("express");
const Roster = require("../models/Roster");
const Class = require("../models/Class");
const DailyAttendance = require("../models/DailyAttendance");

const router = express.Router();

// Get all rosters
router.get("/", async (req, res) => {
  try {
    const rosters = await Roster.find();
    res.json(rosters);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch rosters" });
  }
});

// Save or Update a Roster
router.post("/", async (req, res) => {
  const { cohortName, programme, department, year, semester, section, students } = req.body;
  if (!cohortName) return res.status(400).json({ error: "Cohort name is required" });

  try {
    let roster = await Roster.findOne({ cohortName });
    if (roster) {
      // Update existing
      roster.students = students;
      roster.programme = programme;
      roster.department = department;
      roster.year = year;
      roster.semester = semester;
      roster.section = section;
      await roster.save();

      // Sync changes to all existing classes for this cohort
      const yearSemSec = `${year}/${semester}/${section}`;
      const classesToUpdate = await Class.find({ programme, department, yearSemSec });
      for (const cls of classesToUpdate) {
        const oldStudentsMap = new Map();
        cls.students.forEach(s => oldStudentsMap.set(s.regNo, s));
        
        const newStudents = students.map(rosterStudent => {
          const oldStudent = oldStudentsMap.get(rosterStudent.regNo);
          return {
             regNo: rosterStudent.regNo,
             name: rosterStudent.name,
             dob: rosterStudent.dob,
             gender: rosterStudent.gender,
             studentType: rosterStudent.studentType,
             marks: oldStudent ? oldStudent.marks : [],
             total: oldStudent ? oldStudent.total : 0,
             percentage: oldStudent ? oldStudent.percentage : 0,
             result: oldStudent ? oldStudent.result : "-",
             attendance: oldStudent ? oldStudent.attendance : ""
          };
        });
        
        cls.students = newStudents;
        await cls.save();
      }

      res.json({ message: "Roster updated successfully", roster });
    } else {
      // Create new
      roster = new Roster({
        cohortName,
        programme,
        department,
        year,
        semester,
        section,
        students
      });
      await roster.save();
      res.status(201).json({ message: "Roster created successfully", roster });
    }
  } catch (err) {
    res.status(500).json({ error: "Failed to save roster", details: err.message });
  }
});

// Delete a Roster
router.delete("/:cohortName", async (req, res) => {
  try {
    const result = await Roster.findOneAndDelete({ cohortName: req.params.cohortName });
    if (!result) return res.status(404).json({ error: "Roster not found" });
    res.json({ message: "Roster deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete roster" });
  }
});

// Promote a Roster
router.post("/promote", async (req, res) => {
  const { sourceCohortName, targetYear, targetSemester } = req.body;
  if (!sourceCohortName || !targetYear || !targetSemester) {
    return res.status(400).json({ error: "sourceCohortName, targetYear, and targetSemester are required" });
  }

  try {
    const sourceRoster = await Roster.findOne({ cohortName: sourceCohortName });
    if (!sourceRoster) return res.status(404).json({ error: "Source roster not found" });

    const targetCohortName = `${sourceRoster.programme}-${sourceRoster.department} - ${targetYear}/${targetSemester}/${sourceRoster.section}`;
    
    const existingTarget = await Roster.findOne({ cohortName: targetCohortName });
    if (existingTarget) {
      // Archive the existing conflicting batch
      const currentYear = new Date().getFullYear();
      const archivePrefix = `[ARCHIVED ${currentYear}] `;
      const archiveName = `${archivePrefix}${targetCohortName}`;

      // 1. Rename conflicting Roster
      existingTarget.cohortName = archiveName;
      existingTarget.year = "ARCHIVED";
      await existingTarget.save();

      // 2. Archive conflicting Attendance Records
      await DailyAttendance.updateMany(
        { cohortName: targetCohortName },
        { $set: { cohortName: archiveName } }
      );

      // 3. Archive conflicting Class (Mark) Statements
      const conflictingClasses = await Class.find({
        programme: sourceRoster.programme,
        department: sourceRoster.department,
        yearSemSec: `${targetYear}/${targetSemester}/${sourceRoster.section}`
      });

      for (const cls of conflictingClasses) {
        // Prevent double prefixing if it already has one (edge case)
        if (!cls.className.startsWith("[ARCHIVED")) {
          cls.className = `${archivePrefix}${cls.className}`;
        }
        cls.isDeleted = true; // Hide from standard views
        await cls.save();
      }
    }

    const targetRoster = new Roster({
      cohortName: targetCohortName,
      programme: sourceRoster.programme,
      department: sourceRoster.department,
      year: targetYear,
      semester: targetSemester,
      section: sourceRoster.section,
      students: sourceRoster.students // exact copy of students array
    });

    await targetRoster.save();
    res.status(201).json({ message: "Roster promoted successfully", roster: targetRoster });
  } catch (err) {
    res.status(500).json({ error: "Failed to promote roster", details: err.message });
  }
});

module.exports = router;
