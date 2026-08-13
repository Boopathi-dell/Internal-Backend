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
    const { hallNumber, totalCapacity, columns, layoutType } = req.body;
    const hall = new Hall({ hallNumber, totalCapacity, columns, layoutType });
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
    const { date, iqacNumber, examName, academicYear, branchName, subHeaderText, rosterIds, hallIds, shuffleClasses, libraryFillPreference } = req.body;
    
    if (!hallIds || hallIds.length === 0) {
      return res.status(400).json({ error: "No halls selected." });
    }

    // Fetch selected halls
    const halls = await Hall.find({ _id: { $in: hallIds } }).lean();
    // Sort halls in the exact order of user selection
    halls.sort((a, b) => hallIds.indexOf(a._id.toString()) - hallIds.indexOf(b._id.toString()));
    
    if (halls.length === 0) {
      return res.status(400).json({ error: "Selected halls not found." });
    }

    // Fetch students from selected rosters
    const rosters = await Roster.find({ _id: { $in: rosterIds } }).lean();
    // Sort rosters in the exact order of user selection
    rosters.sort((a, b) => rosterIds.indexOf(a._id.toString()) - rosterIds.indexOf(b._id.toString()));

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
        groups[r.year].push(...r.students.map(s => ({ regNo: s.regNo, branchYearSem: `${r.department}/${r.year}/${r.semester}/${r.section}` })));
      });
    } else {
      // Single year selected
      if (shuffleClasses) {
        // Group by class/cohort (e.g. section)
        rosters.forEach(r => {
          groups[r.cohortName] = r.students.map(s => ({ regNo: s.regNo, branchYearSem: `${r.department}/${r.year}/${r.semester}/${r.section}` }));
        });
      } else {
        // No shuffle, just sequential by cohort
        groups["All"] = [];
        rosters.forEach(r => {
          groups["All"].push(...r.students.map(s => ({ regNo: s.regNo, branchYearSem: `${r.department}/${r.year}/${r.semester}/${r.section}` })));
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
      
      let allocatedStudentsForHall = [];
      
      if (hall.layoutType === 'Library') {
        let capacityLeft = 84; // Fixed library capacity
        
        let computerTables = Array.from({ length: 5 }, () => Array.from({ length: 6 }, () => ["", ""])); // 5 tables, 6 cols, 2 rows
        let readingTables = Array.from({ length: 6 }, () => Array.from({ length: 2 }, () => ["", ""])); // 6 tables, 2 cols, 2 rows
        
        const fillComputer = () => {
          for (let t = 0; t < 5; t++) {
            for (let c = 0; c < 6; c++) {
              for (let r = 0; r < 2; r++) {
                if (studentIndex < totalStudents && computerTables[t][c][r] === "") {
                  let studentObj = orderedStudents[studentIndex];
                  computerTables[t][c][r] = studentObj.regNo;
                  allocatedStudentsForHall.push(studentObj);
                  studentIndex++;
                  capacityLeft--;
                }
              }
            }
          }
        };

        const fillReading = () => {
          for (let t = 0; t < 6; t++) {
            for (let c = 0; c < 2; c++) {
              for (let r = 0; r < 2; r++) {
                if (studentIndex < totalStudents && readingTables[t][c][r] === "") {
                  let studentObj = orderedStudents[studentIndex];
                  readingTables[t][c][r] = studentObj.regNo;
                  allocatedStudentsForHall.push(studentObj);
                  studentIndex++;
                  capacityLeft--;
                }
              }
            }
          }
        };

        if (libraryFillPreference === 'Reading First') {
          fillReading();
          fillComputer();
        } else {
          fillComputer();
          fillReading();
        }

        // Compute ranges
        let summaryRanges = [];
        let grouped = {};
        allocatedStudentsForHall.forEach(s => {
           if (!grouped[s.branchYearSem]) grouped[s.branchYearSem] = [];
           grouped[s.branchYearSem].push(s.regNo);
        });
        
        for (let branch in grouped) {
           let regs = grouped[branch].sort();
           let count = regs.length;
           let rangeStr = count > 1 ? `${regs[0]} - ${regs[count-1]}` : `${regs[0]}`;
           summaryRanges.push({ branch, range: rangeStr, count });
        }

        allocations.push({
          hallId: hall._id,
          hallNumber: hall.hallNumber,
          layoutType: 'Library',
          libraryData: { computerTables, readingTables },
          summaryRanges,
          totalAllocated: 84 - capacityLeft
        });

      } else {
        // Standard Layout
        let studentsInThisHall = Math.min(totalStudents - studentIndex, hall.totalCapacity);
        let baseRows = Math.floor(studentsInThisHall / hall.columns);
        let remainder = studentsInThisHall % hall.columns;
        
        let colCapacities = [];
        for (let i = 0; i < hall.columns; i++) {
          if (i >= hall.columns - remainder) {
            colCapacities.push(baseRows + 1);
          } else {
            colCapacities.push(baseRows);
          }
        }

        let hallColumnsData = Array.from({ length: hall.columns }, () => []);
        let colIndex = 0;
        let studentsPlaced = 0;
        
        // Fill column by column based on calculated capacities
        while (studentsPlaced < studentsInThisHall) {
          let studentObj = orderedStudents[studentIndex];
          hallColumnsData[colIndex].push(studentObj.regNo);
          allocatedStudentsForHall.push(studentObj);
          studentIndex++;
          studentsPlaced++;
          
          if (hallColumnsData[colIndex].length >= colCapacities[colIndex]) {
            colIndex++;
          }
        }

        // Compute ranges
        let summaryRanges = [];
        let grouped = {};
        allocatedStudentsForHall.forEach(s => {
           if (!grouped[s.branchYearSem]) grouped[s.branchYearSem] = [];
           grouped[s.branchYearSem].push(s.regNo);
        });
        
        for (let branch in grouped) {
           let regs = grouped[branch].sort();
           let count = regs.length;
           let rangeStr = count > 1 ? `${regs[0]} - ${regs[count-1]}` : `${regs[0]}`;
           summaryRanges.push({ branch, range: rangeStr, count });
        }

        allocations.push({
          hallId: hall._id,
          hallNumber: hall.hallNumber,
          layoutType: 'Standard',
          columnsData: hallColumnsData,
          summaryRanges,
          totalAllocated: hall.totalCapacity - capacityLeft
        });
      }
    }

    // We don't save to DB immediately on generate, return preview to frontend
    res.json({ examDate: date, examName, academicYear, branchName, subHeaderText, iqacNumber, allocations });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save a seating plan
router.post("/plans", async (req, res) => {
  try {
    const { examDate, examName, academicYear, branchName, subHeaderText, iqacNumber, allocations } = req.body;
    const hallIds = allocations.map(a => a.hallId);
    
    const plan = new SeatingPlan({
      examDate,
      examName,
      academicYear,
      branchName,
      subHeaderText,
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
