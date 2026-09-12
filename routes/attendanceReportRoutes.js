const express = require("express");
const router = express.Router();
const DailyAttendance = require("../models/DailyAttendance");
const Roster = require("../models/Roster");

router.get("/", async (req, res) => {
  try {
    const { year, semester, asOfDate } = req.query;
    
    if (!year || !semester || !asOfDate) {
      return res.status(400).json({ error: "Missing required parameters (year, semester, asOfDate)" });
    }

    // Find all rosters for the given year and semester
    // Cohort format: B.E-CSE - II/III/A
    const regex = new RegExp(`- ${year}/${semester}/([A-Z]+)$`);
    const rosters = await Roster.find({ cohortName: regex });

    if (rosters.length === 0) {
      return res.json({ sections: [], total: null });
    }

    const sectionsData = {};
    let grandTotalStrength = 0;
    
    // Initialize section data
    rosters.forEach(roster => {
      const match = roster.cohortName.match(regex);
      const section = match ? match[1] : "Unknown";
      
      sectionsData[section] = {
        section,
        cohortName: roster.cohortName,
        totalStrength: roster.students.length,
        isMarked: false,
        mrg: { totalPossible: 0, totalPresent: 0, totalAbsent: 0, totalOD: 0, isMarked: false },
        aft: { totalPossible: 0, totalPresent: 0, totalAbsent: 0, totalOD: 0, isMarked: false },
        totalPossible: 0,
        totalPresent: 0,
        totalAbsent: 0,
        totalOD: 0,
        totalLeave: 0
      };
      grandTotalStrength += roster.students.length;
    });

    // Fetch all attendance records up to the asOfDate for these cohorts
    const cohortNames = rosters.map(r => r.cohortName);
    
    const attendances = await DailyAttendance.find({
      cohortName: { $in: cohortNames },
      date: asOfDate,
      isHoliday: false
    }).lean();

    // Aggregate the data
    attendances.forEach(doc => {
      const match = doc.cohortName.match(regex);
      const section = match ? match[1] : "Unknown";
      if (!sectionsData[section]) return;

      const sec = sectionsData[section];
      const isMrg = doc.session === "Morning";
      const sessionObj = isMrg ? sec.mrg : sec.aft;
      
      sec.isMarked = true;
      sessionObj.isMarked = true;
      sessionObj.totalPossible += doc.records.length;
      sec.totalPossible += doc.records.length;
      
      doc.records.forEach(record => {
        if (record.status === "Present") { sessionObj.totalPresent++; sec.totalPresent++; }
        else if (record.status === "Absent") { sessionObj.totalAbsent++; sec.totalAbsent++; }
        else if (record.status === "OD") { sessionObj.totalOD++; sec.totalOD++; }
        else if (record.status === "Leave") { sec.totalLeave++; }
      });
    });

    // Calculate percentages
    const sectionsArray = Object.values(sectionsData).map(sec => {
      sec.mrg.percentage = sec.mrg.totalPossible > 0 ? ((sec.mrg.totalPresent / sec.mrg.totalPossible) * 100).toFixed(2) : "0.00";
      sec.aft.percentage = sec.aft.totalPossible > 0 ? ((sec.aft.totalPresent / sec.aft.totalPossible) * 100).toFixed(2) : "0.00";
      sec.percentage = sec.totalPossible > 0 ? ((sec.totalPresent / sec.totalPossible) * 100).toFixed(2) : "0.00";
      return sec;
    });
    
    // Sort sections alphabetically
    sectionsArray.sort((a, b) => a.section.localeCompare(b.section));

    // Calculate Grand Totals
    const grandTotals = {
      totalStrength: grandTotalStrength,
      totalPossible: 0,
      totalPresent: 0,
      totalAbsent: 0,
      totalOD: 0,
      totalLeave: 0,
      mrg: { totalPossible: 0, totalPresent: 0, totalAbsent: 0, totalOD: 0 },
      aft: { totalPossible: 0, totalPresent: 0, totalAbsent: 0, totalOD: 0 }
    };

    sectionsArray.forEach(sec => {
      grandTotals.totalPossible += sec.totalPossible;
      grandTotals.totalPresent += sec.totalPresent;
      grandTotals.totalAbsent += sec.totalAbsent;
      grandTotals.totalOD += sec.totalOD;
      grandTotals.totalLeave += sec.totalLeave;
      
      grandTotals.mrg.totalPossible += sec.mrg.totalPossible;
      grandTotals.mrg.totalPresent += sec.mrg.totalPresent;
      grandTotals.mrg.totalAbsent += sec.mrg.totalAbsent;
      grandTotals.mrg.totalOD += sec.mrg.totalOD;

      grandTotals.aft.totalPossible += sec.aft.totalPossible;
      grandTotals.aft.totalPresent += sec.aft.totalPresent;
      grandTotals.aft.totalAbsent += sec.aft.totalAbsent;
      grandTotals.aft.totalOD += sec.aft.totalOD;
    });

    grandTotals.percentage = grandTotals.totalPossible > 0 
      ? ((grandTotals.totalPresent / grandTotals.totalPossible) * 100).toFixed(2) 
      : "0.00";
      
    grandTotals.mrg.percentage = grandTotals.mrg.totalPossible > 0 
      ? ((grandTotals.mrg.totalPresent / grandTotals.mrg.totalPossible) * 100).toFixed(2) 
      : "0.00";
      
    grandTotals.aft.percentage = grandTotals.aft.totalPossible > 0 
      ? ((grandTotals.aft.totalPresent / grandTotals.aft.totalPossible) * 100).toFixed(2) 
      : "0.00";

    res.json({ sections: sectionsArray, total: grandTotals });

  } catch (error) {
    console.error("Error generating attendance report:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
