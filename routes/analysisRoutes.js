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

// GET Quick Statistics for Dashboard
router.get("/quick", async (req, res) => {
  try {
    const { exam } = req.query;

    const query = { isDeleted: { $ne: true } };
    if (exam) {
      query.examName = exam;
    } else {
      // If no exam specified, find the most recently created exam name
      const latestClass = await ClassData.findOne({ isDeleted: { $ne: true } }).sort({ _id: -1 });
      if (latestClass) {
        query.examName = latestClass.examName;
      }
    }

    const classes = await ClassData.find(query);

    const statsByYear = {
      "II": { totalStudents: 0, passedStudents: 0 },
      "III": { totalStudents: 0, passedStudents: 0 },
      "IV": { totalStudents: 0, passedStudents: 0 }
    };

    classes.forEach(cls => {
      const year = cls.yearSemSec.split("/")[0];
      if (statsByYear[year]) {
        const total = cls.students.length;
        const passed = cls.students.filter(s => s.result === "Pass").length;
        
        statsByYear[year].totalStudents += total;
        statsByYear[year].passedStudents += passed;
      }
    });

    const formattedStats = ["II", "III", "IV"].map(year => {
      const { totalStudents, passedStudents } = statsByYear[year];
      const passPercentage = totalStudents > 0 ? ((passedStudents / totalStudents) * 100).toFixed(2) : 0;
      return {
        year: `${year} Year`,
        totalStudents,
        passPercentage: Number(passPercentage)
      };
    });

    res.json({ examName: query.examName || "", stats: formattedStats });
  } catch (err) {
    console.error("Error generating quick statistics:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
