const express = require("express");
const router = express.Router();
const StudentRoster = require("../models/StudentRoster");
const ClassData = require("../models/Class");

// ─────────────────────────────────────────────
// GET ALL ROSTERS (metadata only, no students array)
// ─────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const rosters = await StudentRoster.find({}, {
      programme: 1, department: 1, year: 1, section: 1, updatedAt: 1,
      studentCount: { $size: "$students" }
    }).lean();

    // Manually add student count since $size in projection needs aggregation
    const withCount = await StudentRoster.aggregate([
      {
        $project: {
          programme: 1, department: 1, year: 1, section: 1, updatedAt: 1,
          studentCount: { $size: "$students" }
        }
      },
      { $sort: { year: 1, section: 1 } }
    ]);

    res.json(withCount);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// LOOKUP ROSTER BY COHORT (query params)
// GET /api/rosters/lookup?programme=B.E&department=CSE&year=II&section=A
// ─────────────────────────────────────────────
router.get("/lookup", async (req, res) => {
  try {
    const { programme, department, year, section } = req.query;
    if (!year || !section) {
      return res.status(400).json({ error: "year and section are required" });
    }
    const roster = await StudentRoster.findOne({ programme, department, year, section });
    if (!roster) return res.status(404).json({ error: "No roster found" });
    res.json(roster);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET SINGLE ROSTER BY ID (full students list)
// ─────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const roster = await StudentRoster.findById(req.params.id);
    if (!roster) return res.status(404).json({ error: "Roster not found" });
    res.json(roster);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// CREATE OR UPDATE ROSTER + AUTO-SYNC TO ALL MATCHING CLASS RECORDS
// POST /api/rosters
// Body: { programme, department, year, section, students: [...] }
// ─────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const { programme, department, year, section, students } = req.body;
    if (!year || !section || !Array.isArray(students)) {
      return res.status(400).json({ error: "year, section and students array are required" });
    }

    // Upsert the roster
    const roster = await StudentRoster.findOneAndUpdate(
      { programme, department, year, section },
      { programme, department, year, section, students, updatedAt: new Date() },
      { new: true, upsert: true }
    );

    // ── Auto-sync to all matching class records ──────────────────────────────
    // Match yearSemSec like "II/IV/A" where year=II and section=A
    // yearSemSec format: "YEAR/SEM/SECTION"
    const allClasses = await ClassData.find({
      programme,
      department,
      isDeleted: { $ne: true }
    });

    // Filter classes that match year and section (sem can be anything)
    const matchingClasses = allClasses.filter(cls => {
      const parts = (cls.yearSemSec || "").split("/");
      return parts[0] === year && parts[2] === section;
    });

    let syncCount = 0;
    for (const cls of matchingClasses) {
      const numSubjects = cls.subjects ? cls.subjects.length : 0;

      // Build updated student list: merge roster data with existing marks
      const updatedStudents = students.map(rosterStudent => {
        const existing = cls.students.find(s => s.regNo === rosterStudent.regNo);
        if (existing) {
          // Update info fields but PRESERVE marks, total, percentage, result
          return {
            ...existing.toObject(),
            name: rosterStudent.name,
            dob: rosterStudent.dob || existing.dob || "",
            gender: rosterStudent.gender || existing.gender || "Boy",
            studentType: rosterStudent.studentType || existing.studentType || "Day Scholar"
          };
        } else {
          // New student — add with empty marks
          return {
            regNo: rosterStudent.regNo,
            name: rosterStudent.name,
            dob: rosterStudent.dob || "",
            gender: rosterStudent.gender || "Boy",
            studentType: rosterStudent.studentType || "Day Scholar",
            marks: Array(numSubjects).fill(""),
            total: 0,
            percentage: 0,
            result: "-"
          };
        }
      });

      // Also keep students that are in the class but NOT in the new roster (safety — don't lose marks)
      const newRegNos = new Set(students.map(s => s.regNo));
      const extraStudents = cls.students.filter(s => !newRegNos.has(s.regNo));

      cls.students = [...updatedStudents, ...extraStudents];
      await cls.save();
      syncCount++;
    }

    res.json({
      roster,
      syncedClasses: syncCount,
      message: `Roster saved. Synced to ${syncCount} class record(s).`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// DELETE ROSTER
// ─────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    await StudentRoster.findByIdAndDelete(req.params.id);
    res.json({ message: "Roster deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
