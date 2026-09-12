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
        totalPossible: 0,
        totalPresent: 0,
        totalAbsent: 0,
        totalOD: 0,
        totalLeave: 0,
        isMarked: false
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
      
      sec.isMarked = true;
      sec.totalPossible += doc.records.length;
      
      doc.records.forEach(record => {
        if (record.status === "Present") sec.totalPresent++;
        else if (record.status === "Absent") sec.totalAbsent++;
        else if (record.status === "OD") sec.totalOD++;
        else if (record.status === "Leave") sec.totalLeave++;
      });
    });

    // Calculate percentages
    const sectionsArray = Object.values(sectionsData).map(sec => {
      // Let's count Present as Present. If OD is considered Present, we add it. 
      // The user wants "PRESENT EVOLO", so let's just use totalPresent.
      const percentage = sec.totalPossible > 0 ? ((sec.totalPresent / sec.totalPossible) * 100).toFixed(2) : "0.00";
      return { ...sec, percentage };
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
      totalLeave: 0
    };

    sectionsArray.forEach(sec => {
      grandTotals.totalPossible += sec.totalPossible;
      grandTotals.totalPresent += sec.totalPresent;
      grandTotals.totalAbsent += sec.totalAbsent;
      grandTotals.totalOD += sec.totalOD;
      grandTotals.totalLeave += sec.totalLeave;
    });

    grandTotals.percentage = grandTotals.totalPossible > 0 
      ? ((grandTotals.totalPresent / grandTotals.totalPossible) * 100).toFixed(2) 
      : "0.00";

    res.json({ sections: sectionsArray, total: grandTotals });

  } catch (error) {
    console.error("Error generating attendance report:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
