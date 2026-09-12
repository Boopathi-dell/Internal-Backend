const express = require("express");
const DailyAttendance = require("../models/DailyAttendance");
const Roster = require("../models/Roster");
const WorkingDays = require("../models/WorkingDays");

const router = express.Router();

// GET merged attendance (Morning & Afternoon) for a specific cohort and date
router.get("/", async (req, res) => {
  const { cohortName, date } = req.query;
  
  if (!cohortName || !date) {
    return res.status(400).json({ error: "Missing required query parameters: cohortName, date" });
  }

  try {
    const morning = await DailyAttendance.findOne({ cohortName, date, session: "Morning" });
    const afternoon = await DailyAttendance.findOne({ cohortName, date, session: "Afternoon" });
    
    // If neither exists, return a default template from roster
    if (!morning && !afternoon) {
      const roster = await Roster.findOne({ cohortName });
      if (!roster) {
        return res.status(404).json({ error: "Roster not found for this cohort" });
      }
      
      const defaultRecords = roster.students.map(s => ({
        regNo: s.regNo,
        name: s.name,
        morningStatus: "Present",
        afternoonStatus: "Present"
      }));
      
      const parsedDate = new Date(date);
      const isSunday = parsedDate.getUTCDay() === 0;

      return res.json({
        cohortName,
        date,
        isHoliday: isSunday,
        holidayReason: isSunday ? "Sunday" : "",
        records: defaultRecords,
        isNew: true
      });
    }

    // Merge existing records
    // Create a map of regNo to merged record
    const recordsMap = {};
    
    const isHoliday = (morning && morning.isHoliday) || (afternoon && afternoon.isHoliday) || false;
    const holidayReason = (morning && morning.holidayReason) || (afternoon && afternoon.holidayReason) || "";

    if (morning && !morning.isHoliday) {
      morning.records.forEach(r => {
        recordsMap[r.regNo] = { regNo: r.regNo, name: r.name, morningStatus: r.status, afternoonStatus: "Present" };
      });
    }
    
    if (afternoon && !afternoon.isHoliday) {
      afternoon.records.forEach(r => {
        if (!recordsMap[r.regNo]) {
          recordsMap[r.regNo] = { regNo: r.regNo, name: r.name, morningStatus: "Present", afternoonStatus: r.status };
        } else {
          recordsMap[r.regNo].afternoonStatus = r.status;
        }
      });
    }

    // If it's a holiday, records map might be empty, but that's fine. If we need names, we could fetch from roster, 
    // but the frontend hides the table on holiday anyway.
    let records = Object.values(recordsMap);
    
    // Ensure all students from roster exist in the map just in case
    if (!isHoliday) {
       const roster = await Roster.findOne({ cohortName });
       if (roster) {
          roster.students.forEach(s => {
             if (!recordsMap[s.regNo]) {
                 records.push({ regNo: s.regNo, name: s.name, morningStatus: "Present", afternoonStatus: "Present" });
             }
          });
       }
    }

    // Sort records by regNo
    records.sort((a, b) => a.regNo.localeCompare(b.regNo));

    return res.json({
      cohortName,
      date,
      isHoliday,
      holidayReason,
      records,
      isNew: false
    });
    
  } catch (err) {
    console.error("Error fetching daily attendance:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST save or update daily attendance (Morning & Afternoon simultaneously)
router.post("/", async (req, res) => {
  const { cohortName, date, isHoliday, holidayReason, records } = req.body;
  
  if (!cohortName || !date) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const morningRecords = isHoliday ? [] : records.map(r => ({ regNo: r.regNo, name: r.name, status: r.morningStatus }));
    const afternoonRecords = isHoliday ? [] : records.map(r => ({ regNo: r.regNo, name: r.name, status: r.afternoonStatus }));

    // Save Morning
    await DailyAttendance.findOneAndUpdate(
      { cohortName, date, session: "Morning" },
      { isHoliday: isHoliday || false, holidayReason: holidayReason || "", records: morningRecords },
      { upsert: true, new: true }
    );

    // Save Afternoon
    await DailyAttendance.findOneAndUpdate(
      { cohortName, date, session: "Afternoon" },
      { isHoliday: isHoliday || false, holidayReason: holidayReason || "", records: afternoonRecords },
      { upsert: true, new: true }
    );
    
    res.json({ message: "Attendance saved successfully" });
  } catch (err) {
    console.error("Error saving daily attendance:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET missing attendance report for Admin
router.get("/missing", async (req, res) => {
  try {
    const workingDaysConfig = await WorkingDays.find({});
    const rosters = await Roster.find({});
    
    if (workingDaysConfig.length === 0 || rosters.length === 0) {
       return res.json([]);
    }

    const yearConfigs = {};
    workingDaysConfig.forEach(cfg => {
       yearConfigs[cfg.year] = { start: new Date(cfg.startDate), end: new Date(cfg.endDate) };
    });

    // Fetch all attendance records that exist to avoid querying in a loop
    const allAttendances = await DailyAttendance.find({}).lean();
    
    // Create a fast lookup set: Set<"cohortName|date|session">
    const attendanceSet = new Set();
    allAttendances.forEach(a => {
       attendanceSet.add(`${a.cohortName}|${a.date}|${a.session}`);
    });

    const missingReport = [];
    const today = new Date();
    today.setHours(0,0,0,0);

    rosters.forEach(roster => {
       // Extract year from cohortName (e.g. "B.E-CSE - II/IV/A" -> "II")
       const yearMatch = roster.cohortName.match(/ - ([I|V|X]+)\//);
       if (!yearMatch) return;
       const year = yearMatch[1];
       const config = yearConfigs[year];
       
       if (!config) return; // No working days configured for this year

       // Iterate dates from start to end (or today, whichever is earlier)
       let currentDate = new Date(config.start);
       const endDate = config.end < today ? config.end : today;

       while (currentDate <= endDate) {
          // Skip Sundays (0)
          if (currentDate.getUTCDay() !== 0) {
             const dateStr = currentDate.toISOString().slice(0, 10);
             const hasMorning = attendanceSet.has(`${roster.cohortName}|${dateStr}|Morning`);
             const hasAfternoon = attendanceSet.has(`${roster.cohortName}|${dateStr}|Afternoon`);
             
             if (!hasMorning || !hasAfternoon) {
                let missingSession = "Both";
                if (hasMorning && !hasAfternoon) missingSession = "Afternoon";
                if (!hasMorning && hasAfternoon) missingSession = "Morning";
                
                missingReport.push({
                   date: dateStr,
                   cohortName: roster.cohortName,
                   missingSession
                });
             }
          }
          currentDate.setDate(currentDate.getDate() + 1);
       }
    });

    // Sort report by date (descending), then cohortName
    missingReport.sort((a, b) => {
       if (a.date !== b.date) {
          return new Date(b.date) - new Date(a.date);
       }
       return a.cohortName.localeCompare(b.cohortName);
    });

    res.json(missingReport);

  } catch (err) {
    console.error("Error generating missing attendance report:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET summary of attendance for a cohort between two dates (Keep for existing features)
router.get("/summary", async (req, res) => {
  const { cohortName, startDate, endDate } = req.query;
  
  if (!cohortName || !startDate || !endDate) {
    return res.status(400).json({ error: "Missing required parameters: cohortName, startDate, endDate" });
  }

  try {
    const attendances = await DailyAttendance.find({
      cohortName,
      date: { $gte: startDate, $lte: endDate }
    });

    if (attendances.length === 0) {
      return res.json({ summary: [], totalWorkingSessions: 0 });
    }

    const workingSessions = attendances.filter(a => !a.isHoliday);
    const totalWorkingSessions = workingSessions.length;
    
    if (totalWorkingSessions === 0) {
      return res.json({ summary: [], totalWorkingSessions: 0 });
    }

    const studentStats = {};

    workingSessions.forEach(session => {
      session.records.forEach(record => {
        if (!studentStats[record.regNo]) {
          studentStats[record.regNo] = { name: record.name, presentCount: 0, odCount: 0 };
        }
        if (record.status === "Present") {
          studentStats[record.regNo].presentCount += 1;
        } else if (record.status === "OD") {
          studentStats[record.regNo].odCount += 1;
        }
      });
    });

    const summary = Object.keys(studentStats).map(regNo => {
      const stats = studentStats[regNo];
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
