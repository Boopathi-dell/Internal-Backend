const express = require("express");
const DailyAttendance = require("../models/DailyAttendance");
const Roster = require("../models/Roster");

const router = express.Router();

// GET attendance for a specific cohort, date, and session
router.get("/", async (req, res) => {
  const { cohortName, date, session } = req.query;
  
  if (!cohortName || !date || !session) {
    return res.status(400).json({ error: "Missing required query parameters: cohortName, date, session" });
  }

  try {
    const attendance = await DailyAttendance.findOne({ cohortName, date, session });
    
    // If found, return it
    if (attendance) {
      return res.json(attendance);
    }
    
    // If not found, fetch the roster to return a default template
    const roster = await Roster.findOne({ cohortName });
    if (!roster) {
      return res.status(404).json({ error: "Roster not found for this cohort" });
    }
    
    const defaultRecords = roster.students.map(s => ({
      regNo: s.regNo,
      name: s.name,
      status: "Present"
    }));
    
    return res.json({
      cohortName,
      date,
      session,
      isHoliday: false,
      holidayReason: "",
      records: defaultRecords,
      isNew: true // Flag to help frontend know it's unsaved
    });
    
  } catch (err) {
    console.error("Error fetching daily attendance:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST save or update daily attendance
router.post("/", async (req, res) => {
  const { cohortName, date, session, isHoliday, holidayReason, records } = req.body;
  
  if (!cohortName || !date || !session) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    let attendance = await DailyAttendance.findOne({ cohortName, date, session });
    
    if (attendance) {
      // Update existing
      attendance.isHoliday = isHoliday || false;
      attendance.holidayReason = holidayReason || "";
      attendance.records = isHoliday ? [] : records; // clear records if it's a holiday
      await attendance.save();
    } else {
      // Create new
      attendance = new DailyAttendance({
        cohortName,
        date,
        session,
        isHoliday: isHoliday || false,
        holidayReason: holidayReason || "",
        records: isHoliday ? [] : records
      });
      await attendance.save();
    }
    
    res.json({ message: "Attendance saved successfully", data: attendance });
  } catch (err) {
    console.error("Error saving daily attendance:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET summary of attendance for a cohort between two dates
router.get("/summary", async (req, res) => {
  const { cohortName, startDate, endDate } = req.query;
  
  if (!cohortName || !startDate || !endDate) {
    return res.status(400).json({ error: "Missing required parameters: cohortName, startDate, endDate" });
  }

  try {
    // Get all attendance documents in range for this cohort
    const attendances = await DailyAttendance.find({
      cohortName,
      date: { $gte: startDate, $lte: endDate }
    });

    if (attendances.length === 0) {
      return res.json({ summary: [], totalWorkingSessions: 0 });
    }

    // Filter out holidays to find working sessions
    const workingSessions = attendances.filter(a => !a.isHoliday);
    const totalWorkingSessions = workingSessions.length;
    
    if (totalWorkingSessions === 0) {
      return res.json({ summary: [], totalWorkingSessions: 0 });
    }

    // Calculate present count for each student
    const studentStats = {}; // regNo -> presentCount

    workingSessions.forEach(session => {
      session.records.forEach(record => {
        if (!studentStats[record.regNo]) {
          studentStats[record.regNo] = { name: record.name, presentCount: 0, odCount: 0 };
        }
        if (record.status === "Present") {
          studentStats[record.regNo].presentCount += 1;
        } else if (record.status === "OD") {
          // Typically OD is counted as present for percentage calculation
          studentStats[record.regNo].odCount += 1;
        }
      });
    });

    // Create final summary array
    const summary = Object.keys(studentStats).map(regNo => {
      const stats = studentStats[regNo];
      // Formula: ((Present + OD) / Total Working Sessions) * 100
      const effectivePresent = stats.presentCount + stats.odCount;
      const percentage = totalWorkingSessions > 0 ? Math.round((effectivePresent / totalWorkingSessions) * 100) : 0;
      
      return {
        regNo,
        name: stats.name,
        totalSessions: totalWorkingSessions,
        present: stats.presentCount,
        od: stats.odCount,
        percentage
      };
    });

    res.json({ totalWorkingSessions, summary });

  } catch (err) {
    console.error("Error calculating attendance summary:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
