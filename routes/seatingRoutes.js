const express = require("express");
const router = express.Router();
const Hall = require("../models/Hall");
const Roster = require("../models/Roster");
const SeatingPlan = require("../models/SeatingPlan");

// Get all halls
router.get("/halls", async (req, res) => {
  try {
    const halls = await Hall.find().sort({ hallNumber: 1 });
    res.json(halls);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a hall
router.post("/halls", async (req, res) => {
  try {
    const { hallNumber, totalCapacity, columns } = req.body;
    const hall = new Hall({ hallNumber, totalCapacity, columns });
    await hall.save();
    res.json(hall);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete a hall
router.delete("/halls/:id", async (req, res) => {
  try {
    await Hall.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper function to interleave multiple arrays
const interleaveArrays = (arrays) => {
  let result = [];
  let maxLen = Math.max(...arrays.map(a => a.length));
  for (let i = 0; i < maxLen; i++) {
    for (let arr of arrays) {
      if (i < arr.length) {
        result.push(arr[i]);
      }
    }
  }
  return result;
};

// Generate seating plan
router.post("/generate", async (req, res) => {
  try {
    const { date, iqacNumber, rosterIds, shuffleClasses } = req.body;
    
    // Fetch all available halls
    const halls = await Hall.find().sort({ hallNumber: 1 });
    if (halls.length === 0) {
      return res.status(400).json({ error: "No halls available. Please add halls first." });
    }

    // Fetch students from selected rosters
    const rosters = await Roster.find({ _id: { $in: rosterIds } });
    if (rosters.length === 0) {
      return res.status(400).json({ error: "No valid cohorts selected." });
    }

    // Determine grouping strategy for shuffling
    const uniqueYears = [...new Set(rosters.map(r => r.year))];
    let groups = {};

    if (uniqueYears.length > 1) {
      // Multiple years selected -> Group by Year
      rosters.forEach(r => {
        if (!groups[r.year]) groups[r.year] = [];
        groups[r.year].push(...r.students.map(s => s.regNo));
      });
    } else {
      // Single year selected
      if (shuffleClasses) {
        // Group by class/cohort (e.g. section)
        rosters.forEach(r => {
          groups[r.cohortName] = r.students.map(s => s.regNo);
        });
      } else {
        // No shuffle, just sequential by cohort
        groups["All"] = [];
        rosters.forEach(r => {
          groups["All"].push(...r.students.map(s => s.regNo));
        });
      }
    }

    // Interleave the groups to create the final ordered list of students
    const arraysToInterleave = Object.values(groups);
    const orderedStudents = interleaveArrays(arraysToInterleave);

    // Calculate total capacity required
    const totalStudents = orderedStudents.length;
    const totalHallCapacity = halls.reduce((sum, h) => sum + h.totalCapacity, 0);
    if (totalStudents > totalHallCapacity) {
      return res.status(400).json({ error: `Not enough hall capacity. Needed: ${totalStudents}, Available: ${totalHallCapacity}` });
    }

    // Allocate students to halls
    let studentIndex = 0;
    const allocations = [];

    for (let hall of halls) {
      if (studentIndex >= totalStudents) break; // All students allocated

      let rowsPerCol = Math.ceil(hall.totalCapacity / hall.columns);
      let hallColumnsData = Array.from({ length: hall.columns }, () => []);

      let capacityLeft = hall.totalCapacity;
      let colIndex = 0;
      
      // Fill column by column
      while (capacityLeft > 0 && studentIndex < totalStudents) {
        hallColumnsData[colIndex].push(orderedStudents[studentIndex]);
        studentIndex++;
        capacityLeft--;
        
        // Move to next column if current column is full
        if (hallColumnsData[colIndex].length >= rowsPerCol) {
          colIndex++;
        }
      }

      // Generate a summary text for this hall
      const summaryInfo = rosters.map(r => `${r.department}/${r.year} Year / ${r.semester} Sem`).join(", ");

      allocations.push({
        hallId: hall._id,
        hallNumber: hall.hallNumber,
        columnsData: hallColumnsData,
        summaryInfo: `${summaryInfo} - Total: ${hall.totalCapacity - capacityLeft}`
      });
    }

    // We don't save to DB immediately on generate, return preview to frontend
    res.json({ examDate: date, iqacNumber, allocations });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save a seating plan
router.post("/plans", async (req, res) => {
  try {
    const { examDate, iqacNumber, allocations } = req.body;
    const hallIds = allocations.map(a => a.hallId);
    
    const plan = new SeatingPlan({
      examDate,
      iqacNumber,
      halls: hallIds,
      allocations
    });
    
    await plan.save();
    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all saved plans
router.get("/plans", async (req, res) => {
  try {
    const plans = await SeatingPlan.find().sort({ createdAt: -1 });
    res.json(plans);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a saved plan
router.delete("/plans/:id", async (req, res) => {
  try {
    await SeatingPlan.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
