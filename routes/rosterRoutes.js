const express = require("express");
const Roster = require("../models/Roster");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// Get all rosters
router.get("/", authMiddleware, async (req, res) => {
  try {
    const rosters = await Roster.find();
    res.json(rosters);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch rosters" });
  }
});

// Save or Update a Roster
router.post("/", authMiddleware, async (req, res) => {
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
router.delete("/:cohortName", authMiddleware, async (req, res) => {
  try {
    const result = await Roster.findOneAndDelete({ cohortName: req.params.cohortName });
    if (!result) return res.status(404).json({ error: "Roster not found" });
    res.json({ message: "Roster deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete roster" });
  }
});

module.exports = router;
