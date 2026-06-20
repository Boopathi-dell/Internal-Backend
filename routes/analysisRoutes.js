const express = require("express");
const router = express.Router();
const ClassData = require("../models/Class");

// GET Department Analysis Data
router.get("/department", async (req, res) => {
  try {
    const { year, semester, exam, department } = req.query;

    if (!year || !semester || !exam) {
      return res.status(400).json({ error: "Missing required parameters: year, semester, exam" });
    }

    // Find all classes matching the criteria
    // Class documents have yearSemSec like "III/VI/A"
    const query = {
      yearSemSec: { $regex: new RegExp(`^${year}/${semester}/`) },
      examName: exam,
      isDeleted: { $ne: true }
    };
    
    if (department) {
      query.department = department;
    }

    const classes = await ClassData.find(query);

    if (!classes || classes.length === 0) {
      return res.json([]);
    }

    // Aggregate data by section
    const analysisData = classes.map(cls => {
      const parts = cls.yearSemSec.split("/");
      const section = parts.length === 3 ? parts[2] : "Unknown";
      
      const totalStudents = cls.students.length;
      const passedStudents = cls.students.filter(s => s.result === "Pass").length;
      const failedStudents = totalStudents - passedStudents;
      const passPercentage = totalStudents > 0 ? ((passedStudents / totalStudents) * 100).toFixed(2) : 0;

      return {
        id: cls._id,
        className: cls.className,
        section,
        totalStudents,
        passedStudents,
        failedStudents,
        passPercentage
      };
    });

    // Sort by section (A, B, C...)
    analysisData.sort((a, b) => a.section.localeCompare(b.section));

    res.json(analysisData);
  } catch (err) {
    console.error("Error generating department analysis:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
