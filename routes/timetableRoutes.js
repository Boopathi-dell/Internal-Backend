const express = require("express");
const router = express.Router();
const Staff = require("../models/Staff");
const User = require("../models/User");
const SubjectMaster = require("../models/SubjectMaster");
const TimetableAllocation = require("../models/TimetableAllocation");
const TimetableSchedule = require("../models/TimetableSchedule");
const TimetableHistory = require("../models/TimetableHistory");

// Period timing defaults matching official MEC timetable
const DEFAULT_TIMINGS = {
  1: "09:10 - 10:05",
  2: "10:05 - 11:00",
  3: "11:15 - 12:10",
  4: "12:10 - 01:00",
  5: "01:45 - 02:40",
  6: "02:40 - 03:35",
  7: "03:35 - 04:30",
  teaBreak: "11:00 - 11:15",
  lunchBreak: "01:00 - 01:45"
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const PERIODS = [1, 2, 3, 4, 5, 6, 7];

// ==========================================
// 1. STAFF MASTER ROUTES
// ==========================================

// GET all staff members
router.get("/staff", async (req, res) => {
  try {
    const { department } = req.query;
    const filter = {};
    if (department && department !== "All") {
      filter.department = { $regex: new RegExp(`^${department}$`, "i") };
    }
    const staff = await Staff.find(filter).sort({ name: 1 });
    res.json(staff);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CREATE a staff member
router.post("/staff", async (req, res) => {
  try {
    const { name, staffCode, email, department, designation, maxHoursPerWeek, maxTheory, maxLab, phone } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Staff name is required" });
    }
    const staff = new Staff({
      name: name.trim(),
      staffCode: staffCode || "",
      email: email || "",
      department: (department || "CSE").toUpperCase(),
      designation: designation || "Assistant Professor",
      maxHoursPerWeek: Number(maxHoursPerWeek) || 18,
      maxTheory: Number(maxTheory) || 2,
      maxLab: Number(maxLab) || 2,
      phone: phone || ""
    });
    await staff.save();
    res.json(staff);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// UPDATE a staff member
router.put("/staff/:id", async (req, res) => {
  try {
    const { name, staffCode, email, department, designation, maxHoursPerWeek, maxTheory, maxLab, phone } = req.body;
    const updateData = {};
    if (name) updateData.name = name.trim();
    if (staffCode !== undefined) updateData.staffCode = staffCode;
    if (email !== undefined) updateData.email = email;
    if (department) updateData.department = department.toUpperCase();
    if (designation) updateData.designation = designation;
    if (maxHoursPerWeek !== undefined) updateData.maxHoursPerWeek = Number(maxHoursPerWeek);
    if (maxTheory !== undefined) updateData.maxTheory = Number(maxTheory);
    if (maxLab !== undefined) updateData.maxLab = Number(maxLab);
    if (phone !== undefined) updateData.phone = phone;

    const staff = await Staff.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!staff) return res.status(404).json({ error: "Staff not found" });
    res.json(staff);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE a staff member
router.delete("/staff/:id", async (req, res) => {
  try {
    await Staff.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SYNC staff from ALL Users in User collection (including Teaching Assistants)
router.post("/staff/sync-users", async (req, res) => {
  try {
    const users = await User.find({});
    let addedCount = 0;
    for (const u of users) {
      if (!u.name || !u.name.trim()) continue;
      const cleanName = u.name.trim();
      const existing = await Staff.findOne({ 
        name: { $regex: new RegExp(`^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") } 
      });
      if (!existing) {
        await Staff.create({
          name: cleanName,
          email: u.email || "",
          department: (u.department || "CSE").toUpperCase(),
          designation: u.designation || "Teaching Assistant",
          maxHoursPerWeek: 18,
          maxTheory: 2,
          maxLab: 2
        });
        addedCount++;
      }
    }
    const allStaff = await Staff.find().sort({ name: 1 });
    res.json({ 
      message: `Synced ${addedCount} faculty members from Users! (Total: ${allStaff.length})`, 
      staff: allStaff, 
      totalSynced: addedCount 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 2. SUBJECT MASTER ROUTES
// ==========================================

// GET subjects by dept, year, sem, batch
router.get("/subjects", async (req, res) => {
  try {
    const { department, year, semester, batch } = req.query;
    const query = {};
    if (department) query.department = department;
    if (year) query.year = year;
    if (semester) query.semester = Number(semester);
    if (batch) query.batch = batch;

    const list = await SubjectMaster.find(query).sort({ year: 1, semester: 1 });
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SAVE or UPDATE subjects for a Year & Semester
router.post("/subjects", async (req, res) => {
  try {
    const { department, batch, year, semester, subjects } = req.body;
    if (!year || !semester || !batch) {
      return res.status(400).json({ error: "Batch, Year, and Semester are required" });
    }

    const doc = await SubjectMaster.findOneAndUpdate(
      { department: department || "CSE", batch, year, semester: Number(semester) },
      {
        department: department || "CSE",
        batch,
        year,
        semester: Number(semester),
        subjects: subjects || [],
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );

    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE a subject master record
router.delete("/subjects/:id", async (req, res) => {
  try {
    await SubjectMaster.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3. WORKLOAD ALLOCATION ROUTES
// ==========================================

// GET current allocations for academicYear & semesterType
router.get("/allocation", async (req, res) => {
  try {
    const { department = "CSE", academicYear = "2026-2027", semesterType = "Odd" } = req.query;
    let allocation = await TimetableAllocation.findOne({ department, academicYear, semesterType });
    if (!allocation) {
      allocation = { 
        department, 
        academicYear, 
        semesterType, 
        allocations: [],
        iqacNumber: "MEC/IQAC/2026 - 27/CSE/006",
        hallNumbers: {},
        coordinators: {},
        periodTimings: DEFAULT_TIMINGS
      };
    } else if (!allocation.periodTimings || Object.keys(allocation.periodTimings).length === 0) {
      allocation = allocation.toObject();
      allocation.periodTimings = DEFAULT_TIMINGS;
    }
    res.json(allocation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SAVE workload allocations, year-sections & class-advisors
router.post("/allocation", async (req, res) => {
  try {
    const { 
      department = "CSE", 
      academicYear = "2026-2027", 
      semesterType = "Odd", 
      allocations = [], 
      yearSections,
      classAdvisors,
      iqacNumber,
      hallNumbers,
      coordinators,
      periodTimings
    } = req.body;

    const updateData = { department, academicYear, semesterType, allocations, updatedAt: new Date() };
    if (yearSections) updateData.yearSections = yearSections;
    if (classAdvisors) updateData.classAdvisors = classAdvisors;
    if (iqacNumber !== undefined) updateData.iqacNumber = iqacNumber;
    if (hallNumbers !== undefined) updateData.hallNumbers = hallNumbers;
    if (coordinators !== undefined) updateData.coordinators = coordinators;
    if (periodTimings !== undefined) updateData.periodTimings = periodTimings;

    const doc = await TimetableAllocation.findOneAndUpdate(
      { department, academicYear, semesterType },
      updateData,
      { upsert: true, new: true }
    );
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==========================================
// 4. CLASH-FREE TIMETABLE GENERATION ALGORITHM
// ==========================================

router.post("/generate", async (req, res) => {
  try {
    const {
      department = "CSE",
      academicYear = "2026-2027",
      semesterType = "Odd",
      allocations = [],
      classAdvisors: inputClassAdvisors,
      timings: inputTimings
    } = req.body;

    let classAdvisors = inputClassAdvisors;
    let timings = inputTimings;

    const savedAlloc = await TimetableAllocation.findOne({ department, academicYear, semesterType });
    if (!classAdvisors || Object.keys(classAdvisors).length === 0) {
      if (savedAlloc && savedAlloc.classAdvisors) {
        classAdvisors = savedAlloc.classAdvisors;
      } else {
        classAdvisors = {};
      }
    }

    if (!timings || Object.keys(timings).length === 0) {
      if (savedAlloc && savedAlloc.periodTimings && Object.keys(savedAlloc.periodTimings).length > 0) {
        timings = savedAlloc.periodTimings;
      } else {
        timings = DEFAULT_TIMINGS;
      }
    }

    if (!allocations || allocations.length === 0) {
      return res.status(400).json({ error: "No subject-staff allocations provided to generate timetable." });
    }

    // Check if current timetable is LOCKED (Finalized)
    const existingSchedule = await TimetableSchedule.findOne({ department, academicYear, semesterType });
    if (existingSchedule && existingSchedule.isLocked) {
      return res.status(400).json({ 
        error: "Timetable is LOCKED (Finalized)! Please unlock it in the Admin Panel before generating a new schedule." 
      });
    }

    // Auto-Archive existing schedule into TimetableHistory before overwriting!
    if (existingSchedule && existingSchedule.classes && existingSchedule.classes.length > 0) {
      const histCount = await TimetableHistory.countDocuments({ department, academicYear, semesterType });
      const dtStr = new Date(existingSchedule.generatedAt || Date.now()).toLocaleDateString("en-IN", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
      });
      await TimetableHistory.create({
        department,
        academicYear,
        semesterType,
        versionName: `Version ${histCount + 1} (${dtStr})`,
        classes: existingSchedule.classes,
        isLocked: existingSchedule.isLocked || false,
        generatedAt: existingSchedule.generatedAt || new Date()
      });
    }

    // Sync with SubjectMaster so latest slotPattern (e.g. "2+2", "2+1") is ALWAYS honored directly from curriculum
    try {
      const subjectMasters = await SubjectMaster.find({ department: department || "CSE" });
      const curriculumMap = {};
      subjectMasters.forEach(sm => {
        (sm.subjects || []).forEach(s => {
          if (s.code) {
            const keySem = `${sm.year}-${sm.semester}-${s.code.toUpperCase()}`;
            curriculumMap[keySem] = s;
            curriculumMap[`${sm.year}-${s.code.toUpperCase()}`] = s;
            curriculumMap[s.code.toUpperCase()] = s;
          }
        });
      });

      allocations.forEach(a => {
        const codeKey = a.subjectCode ? a.subjectCode.toUpperCase() : "";
        const curr = curriculumMap[`${a.year}-${a.semester}-${codeKey}`] || curriculumMap[`${a.year}-${codeKey}`] || curriculumMap[codeKey];
        if (curr) {
          // STRICT: Whatever Admin configured for this subject in Curriculum Master MUST be enforced!
          const chosenPattern = curr.slotPattern || a.slotPattern || "regular";
          a.slotPattern = chosenPattern;
          a.isTraining = chosenPattern !== "regular";

          if (curr.difficulty) {
            a.difficulty = curr.difficulty;
          }
          if (curr.hoursPerWeek) {
            a.hoursPerWeek = Number(curr.hoursPerWeek);
          }
        } else {
          a.slotPattern = a.slotPattern || "regular";
          a.isTraining = a.slotPattern !== "regular";
        }
      });
    } catch (e) {
      console.log("Could not sync SubjectMaster during generation:", e);
    }

    // 1. Group allocations by classKey e.g. "II-A", "III-A", "IV-A"
    const classGroups = {};
    allocations.forEach(item => {
      const classKey = `${item.year}-${item.section || "A"}`;
      if (!classGroups[classKey]) {
        classGroups[classKey] = {
          classKey,
          year: item.year,
          section: item.section || "A",
          semester: item.semester,
          allocations: []
        };
      }
      classGroups[classKey].allocations.push(item);
    });

    const classKeys = Object.keys(classGroups);

    // 2. Initialize Class Slots and Faculty Global Busy Matrix
    // classSchedule[classKey][day][period]
    const classGrid = {};
    classKeys.forEach(ck => {
      classGrid[ck] = {};
      DAYS.forEach(day => {
        classGrid[ck][day] = {};
        PERIODS.forEach(p => {
          classGrid[ck][day][p] = null;
        });
      });
    });

    // facultyBusy[facultyName][day][period] = classKey
    const facultyBusy = {};
    const markFacultyBusy = (facultyName, day, period, classKey) => {
      if (!facultyName) return;
      if (!facultyBusy[facultyName]) facultyBusy[facultyName] = {};
      if (!facultyBusy[facultyName][day]) facultyBusy[facultyName][day] = {};
      facultyBusy[facultyName][day][period] = classKey;
    };

    const isFacultyFree = (facultyName, day, period) => {
      if (!facultyName) return true;
      if (!facultyBusy[facultyName]) return true;
      if (!facultyBusy[facultyName][day]) return true;
      return !facultyBusy[facultyName][day][period];
    };

    // Helper: Daily teaching hours for faculty on day
    const getFacultyDailyHours = (facultyName, day) => {
      if (!facultyName || !facultyBusy[facultyName] || !facultyBusy[facultyName][day]) return 0;
      return Object.keys(facultyBusy[facultyName][day]).length;
    };

    // Helper: Checks if placing (facultyName, day, p) causes >= 3 consecutive hours for that faculty
    const causesFacultyContinuousFatigue = (facultyName, day, p) => {
      if (!facultyName) return false;
      const left1 = p > 1 && !isFacultyFree(facultyName, day, p - 1);
      const left2 = p > 2 && !isFacultyFree(facultyName, day, p - 2);
      if (left1 && left2) return true;

      const right1 = p < 7 && !isFacultyFree(facultyName, day, p + 1);
      const right2 = p < 6 && !isFacultyFree(facultyName, day, p + 2);
      if (right1 && right2) return true;

      if (left1 && right1) return true;

      return false;
    };

    // Helper: Checks if slot is adjacent to another hour for this faculty (1-hour neighbor)
    const hasAdjacentFacultyHour = (facultyName, day, p) => {
      if (!facultyName) return false;
      const left = p > 1 && !isFacultyFree(facultyName, day, p - 1);
      const right = p < 7 && !isFacultyFree(facultyName, day, p + 1);
      return left || right;
    };

    // Helper: How many days in the week facultyName teaches during period 'p' (across all classes)
    const getFacultyPeriodCount = (facultyName, p) => {
      if (!facultyName || !facultyBusy[facultyName]) return 0;
      let count = 0;
      DAYS.forEach(d => {
        if (facultyBusy[facultyName][d] && facultyBusy[facultyName][d][p]) {
          count++;
        }
      });
      return count;
    };

    // Helper: How many days in the week this class has this subjectCode during period 'p'
    const getSubjectPeriodCount = (ck, subjectCode, p) => {
      let count = 0;
      DAYS.forEach(d => {
        const slot = classGrid[ck][d][p];
        if (slot && slot.subjectCode === subjectCode) {
          count++;
        }
      });
      return count;
    };

    // Helper: Morning vs Afternoon distribution for a subject in this class
    const getSubjectMorningCount = (ck, subjectCode) => {
      let count = 0;
      DAYS.forEach(d => {
        [1, 2, 3, 4].forEach(p => {
          if (classGrid[ck][d][p] && classGrid[ck][d][p].subjectCode === subjectCode) count++;
        });
      });
      return count;
    };

    const getSubjectAfternoonCount = (ck, subjectCode) => {
      let count = 0;
      DAYS.forEach(d => {
        [5, 6, 7].forEach(p => {
          if (classGrid[ck][d][p] && classGrid[ck][d][p].subjectCode === subjectCode) count++;
        });
      });
      return count;
    };

    // Helper: How many periods on 'day' are already taken by block sessions (Lab, Project, Training)
    const getClassBlockCountOnDay = (ck, day) => {
      let count = 0;
      PERIODS.forEach(p => {
        const slot = classGrid[ck][day][p];
        if (slot && (isBlockType(slot.type) || slot.isTraining)) {
          count++;
        }
      });
      return count;
    };

    // Helper: Dynamic Candidate blocks for Lab based on hoursPerWeek (Supports 1-hr, 2-hr, 3-hr, 4-hr labs)
    // CRITICAL: Blocks must NEVER cross the lunch break (between Period 4 and Period 5)!
    const getLabCandidateBlocks = (hours) => {
      const dur = Number(hours) || 3;
      if (dur === 2) {
        return [
          { name: "Afternoon (5-6)", periods: [5, 6] },
          { name: "Afternoon (6-7)", periods: [6, 7] },
          { name: "Morning (3-4)", periods: [3, 4] },
          { name: "Morning (1-2)", periods: [1, 2] }
        ];
      }
      if (dur === 1) {
        return [
          { name: "Period 7", periods: [7] },
          { name: "Period 6", periods: [6] },
          { name: "Period 5", periods: [5] }
        ];
      }
      if (dur >= 4) {
        return [
          { name: "Morning (1-4)", periods: [1, 2, 3, 4] }
        ];
      }
      // Standard 3 hours
      return [
        { name: "Afternoon (5-7)", periods: [5, 6, 7] },
        { name: "Morning (1-3)", periods: [1, 2, 3] },
        { name: "Morning (2-4)", periods: [2, 3, 4] }
      ];
    };

    const isBlockType = (type) => {
      const t = (type || "").toLowerCase();
      return t.includes("lab") || t.includes("project");
    };

    const isTrainingSubject = (item) => {
      if (!item) return false;
      if (item.isTraining === true) return true;
      const t = (item.type || "").toLowerCase();
      return t.includes("training") || t.includes("trainer");
    };

    // Helper: Parse slot pattern into continuous chunks & single hours
    // Generic parser: Supports presets ("2+2", "2+1", "2+1+1", "3+1", "4", "3", "2") and ANY custom pattern (e.g. "2+1", "3+2", "2+2+1", "1+1+2")
    const parseSlotPattern = (pat, hours, isTr, type) => {
      const total = Number(hours) || 4;
      const cleanPat = (pat || "").trim().toLowerCase();

      // Explicit single-number requests
      if (cleanPat === "4" || cleanPat === "4h" || cleanPat === "half-day") {
        return { blocks: [4], singles: Math.max(0, total - 4) };
      }
      if (cleanPat === "3" || cleanPat === "3h") {
        return { blocks: [3], singles: Math.max(0, total - 3) };
      }
      if (cleanPat === "2" || cleanPat === "2h") {
        return { blocks: [2], singles: Math.max(0, total - 2) };
      }

      // Explicit "2+2": Always two 2-hour blocks on separate alternate days
      if (cleanPat === "2+2") {
        return { blocks: [2, 2], singles: Math.max(0, total - 4) };
      }

      // Explicit "2+1": 2-hour continuous block on Day 1 + 1-hour single on Day 2
      if (cleanPat === "2+1") {
        return { blocks: [2], singles: Math.max(0, total - 2) };
      }

      // Explicit "2+1+1": 2-hour continuous block on Day 1 + two 1-hour singles
      if (cleanPat === "2+1+1") {
        return { blocks: [2], singles: Math.max(0, total - 2) };
      }

      // Explicit "3+1": 3-hour continuous block + 1-hour single
      if (cleanPat === "3+1") {
        return { blocks: [3], singles: Math.max(0, total - 3) };
      }

      // Explicit "4+3": Trainer morning/afternoon flip across sections
      if (cleanPat === "4+3") {
        return { blocks: [4, 3], singles: Math.max(0, total - 7) };
      }

      // If regular or empty with no training flag
      if (cleanPat === "regular" || (!cleanPat && !isTr && !(type && type.toLowerCase().includes("training")))) {
        return { blocks: [], singles: total };
      }

      // If trainer / continuous flag without explicit pattern:
      // CRITICAL: 4 hours MUST default to [2, 2] on alternate days! NEVER [4] on a single day!
      if (!cleanPat && (isTr || (type && type.toLowerCase().includes("training")))) {
        if (total >= 7) return { blocks: [4, 3], singles: Math.max(0, total - 7) };
        if (total === 6) return { blocks: [2, 2, 2], singles: 0 };
        if (total === 5) return { blocks: [2, 2], singles: 1 };
        if (total === 4) return { blocks: [2, 2], singles: 0 }; // 4 hours -> 2h + 2h alternate days!
        if (total === 3) return { blocks: [2], singles: 1 };     // 3 hours -> 2h block + 1h single!
        if (total === 2) return { blocks: [2], singles: 0 };
        return { blocks: [], singles: total };
      }

      // Parse any custom expression containing numbers separated by '+', comma, or space (e.g. "2+1", "2+2", "3+1", "2+1+1", "4")
      const parts = cleanPat.split(/[\+,\s\-\/]+/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0);

      if (parts.length > 0) {
        if (parts.length === 1) {
          if (parts[0] === 4) return { blocks: [4], singles: Math.max(0, total - 4) };
          if (parts[0] === 3) return { blocks: [3], singles: Math.max(0, total - 3) };
          if (parts[0] === 2) return { blocks: [2], singles: Math.max(0, total - 2) };
        }

        const blocks = [];
        let singles = 0;
        let patternSum = 0;

        parts.forEach(p => {
          patternSum += p;
          if (p >= 2) {
            blocks.push(p);
          } else {
            singles += p;
          }
        });

        // If total hours allocated > sum of pattern, remainder goes to singles
        if (total > patternSum) {
          singles += (total - patternSum);
        }

        return { blocks, singles };
      }

      return { blocks: [], singles: total };
    };

    // Candidate blocks for any continuous chunk duration (NEVER crosses lunch break)
    const getCandidateBlocksForDuration = (dur) => {
      if (dur >= 4) {
        return [
          { name: "Morning (1-4)", periods: [1, 2, 3, 4] }
        ];
      }
      if (dur === 3) {
        return [
          { name: "Afternoon (5-7)", periods: [5, 6, 7] },
          { name: "Morning (1-3)", periods: [1, 2, 3] },
          { name: "Morning (2-4)", periods: [2, 3, 4] }
        ];
      }
      if (dur === 2) {
        return [
          { name: "Morning (1-2)", periods: [1, 2] },
          { name: "Morning (3-4)", periods: [3, 4] },
          { name: "Afternoon (5-6)", periods: [5, 6] },
          { name: "Afternoon (6-7)", periods: [6, 7] }
        ];
      }
      return [
        { name: "Period 7", periods: [7] },
        { name: "Period 6", periods: [6] },
        { name: "Period 5", periods: [5] }
      ];
    };

    const unplacedLabs = [];
    const unplacedTheory = [];

    // --- STEP 0: CLASS ADVISOR SUBJECT ON MONDAY PERIOD 1 ---
    // User Requirement:
    // Monday first hour is NOT a dummy advisor hour.
    // If the advisor teaches any subject in this class, schedule that real subject on Monday Period 1.
    // If the advisor does NOT teach any subject in this class, do not insert any dummy hour!
    classKeys.forEach(ck => {
      const advisor = classAdvisors && classAdvisors[ck];
      if (!advisor) return;

      if (!isFacultyFree(advisor, "Monday", 1)) {
        return;
      }

      // Check if advisor teaches any theory/subject in this class
      const classTheorySubjs = classGroups[ck].allocations.filter(a => !isBlockType(a.type));
      const advisorSubj = classTheorySubjs.find(a => (a.facultyNames || []).includes(advisor));

      if (advisorSubj) {
        classGrid[ck]["Monday"][1] = {
          period: 1,
          time: timings[1] || DEFAULT_TIMINGS[1],
          subjectCode: advisorSubj.subjectCode,
          subjectName: advisorSubj.subjectName,
          shortName: advisorSubj.shortName || advisorSubj.subjectCode,
          facultyName: advisor,
          facultyNames: [advisor],
          type: advisorSubj.type || "Theory",
          difficulty: advisorSubj.difficulty || "Normal",
          room: "LH-1",
          isClassAdvisorHour: false
        };
        markFacultyBusy(advisor, "Monday", 1, ck);
        advisorSubj.advisorHourPlaced = true;
      }
      // If advisor does not teach any subject in this class, do NOT place dummy ADVISOR slot.
      // Monday Period 1 remains open to be naturally filled by regular subjects.
    });

    // --- STEP A: PLACE LAB & PROJECT SESSIONS FIRST (Respects allocated hours: 2 hrs / 3 hrs) ---
    classKeys.forEach(ck => {
      const classLabs = classGroups[ck].allocations.filter(a => {
        if (!isBlockType(a.type)) return false;
        // If lab has a custom split pattern (e.g. "2+1" for CDS-III), do NOT place as single 3-hour block!
        const pat = (a.slotPattern || "").trim().toLowerCase();
        if (pat && pat !== "regular" && pat !== "3" && pat !== "3h" && pat !== "block") {
          return false; // Skip monolithic lab placement; Step A.2 handles the split!
        }
        return true;
      });
      
      classLabs.forEach(lab => {
        let placed = false;
        const facs = lab.facultyNames || [];
        const labDuration = Number(lab.hoursPerWeek) || 3;
        const candidateBlocks = getLabCandidateBlocks(labDuration);

        // Distribute days across week by prioritizing days with fewest/zero existing blocks
        const candidateDays = [...DAYS].sort((d1, d2) => {
          const c1 = getClassBlockCountOnDay(ck, d1);
          const c2 = getClassBlockCountOnDay(ck, d2);
          if (c1 !== c2) return c1 - c2;
          return Math.random() - 0.5;
        });

        for (let d = 0; d < candidateDays.length && !placed; d++) {
          const day = candidateDays[d];
          // If this day already has >= 3 block periods, skip to a day with fewer blocks
          if (getClassBlockCountOnDay(ck, day) >= 3 && candidateDays.some(od => getClassBlockCountOnDay(ck, od) < 2)) {
            continue;
          }

          for (const block of candidateBlocks) {
            // Check if class is free for all periods in this block
            const classFree = block.periods.every(p => classGrid[ck][day][p] === null);
            if (!classFree) continue;

            // Check if ALL assigned faculties are free for all periods (CRITICAL ZERO CLASH!)
            const allFacsFree = facs.every(f => 
              block.periods.every(p => isFacultyFree(f, day, p))
            );
            if (!allFacsFree) continue;

            // All free! Place Lab / Project with exact allocated duration
            block.periods.forEach(p => {
              classGrid[ck][day][p] = {
                period: p,
                time: timings[p] || DEFAULT_TIMINGS[p],
                subjectCode: lab.subjectCode,
                subjectName: lab.subjectName,
                shortName: lab.shortName || lab.subjectCode,
                facultyName: facs.join(", "),
                facultyNames: facs,
                type: lab.type || "Lab",
                difficulty: lab.difficulty || "Normal",
                room: `${lab.shortName || (lab.type || "LAB")}`
              };
              facs.forEach(f => markFacultyBusy(f, day, p, ck));
            });

            placed = true;
            break;
          }
        }

        if (!placed) {
          unplacedLabs.push({ classKey: ck, subject: lab.subjectName, faculty: facs.join(", ") });
        }
      });
    });

    // --- STEP A.2: PLACE CONTINUOUS SESSIONS (Pattern e.g. 2+2, 2+1, 2+1+1, 3+1, 4, Training) ---
    // User Requirement:
    // Support Admin-chosen Continuous Hours pattern (e.g. DAA 4 hrs = 2h + 2h continuous blocks on ALTERNATE days, CDS 3 hrs = 2h + 1h).
    // Section A and Section B swap morning and afternoon across days so trainer never clashes!
    classKeys.forEach(ck => {
      const classContinuousSubjs = classGroups[ck].allocations.filter(a => {
        const pat = (a.slotPattern || "").trim().toLowerCase();
        // If user explicitly gave a pattern (e.g. "2+1", "2+2", "3+1", etc.), handle it here regardless of type (including Labs like CDS)!
        if (pat && pat !== "regular") {
          const parsed = parseSlotPattern(a.slotPattern, a.hoursPerWeek, a.isTraining, a.type);
          return parsed.blocks && parsed.blocks.length > 0;
        }
        // If marked as training, and not a standard monolithic lab:
        if (a.isTraining || (a.type && a.type.toLowerCase().includes("training"))) {
          if (isBlockType(a.type)) return false;
          const parsed = parseSlotPattern(a.slotPattern, a.hoursPerWeek, a.isTraining, a.type);
          return parsed.blocks && parsed.blocks.length > 0;
        }
        return false;
      });

      classContinuousSubjs.forEach(item => {
        const parsed = parseSlotPattern(item.slotPattern, item.hoursPerWeek, item.isTraining, item.type);
        const facs = item.facultyNames || [];
        item.placedBlocksHours = 0;
        item.placedBlockDays = [];

        for (const blockDur of parsed.blocks) {
          const candidateBlocks = getCandidateBlocksForDuration(blockDur);
          let blockPlaced = false;

          // Days prioritized by:
          // 1. Not already containing this subject today (strict skip)
          // 2. Alternate day spacing from previously placed blocks of this subject (e.g. Monday -> Wednesday / Thursday)
          // 3. Fewest existing blocks on that day
          const candidateDays = [...DAYS].sort((d1, d2) => {
            const hasSubj1 = classGrid[ck][d1] && PERIODS.some(p => classGrid[ck][d1][p]?.subjectCode === item.subjectCode) ? 100 : 0;
            const hasSubj2 = classGrid[ck][d2] && PERIODS.some(p => classGrid[ck][d2][p]?.subjectCode === item.subjectCode) ? 100 : 0;
            if (hasSubj1 !== hasSubj2) return hasSubj1 - hasSubj2;

            // Alternate day preference: Prefer days with >= 2 days gap from already placed block of this subject
            const placedDays = item.placedBlockDays || [];
            const isAlt1 = placedDays.length === 0 || placedDays.some(pd => Math.abs(DAYS.indexOf(d1) - DAYS.indexOf(pd)) >= 2);
            const isAlt2 = placedDays.length === 0 || placedDays.some(pd => Math.abs(DAYS.indexOf(d2) - DAYS.indexOf(pd)) >= 2);
            if (isAlt1 !== isAlt2) return isAlt1 ? -1 : 1;

            const c1 = getClassBlockCountOnDay(ck, d1);
            const c2 = getClassBlockCountOnDay(ck, d2);
            if (c1 !== c2) return c1 - c2;
            return Math.random() - 0.5;
          });

          for (let d = 0; d < candidateDays.length && !blockPlaced; d++) {
            const day = candidateDays[d];

            // Don't place two blocks of the SAME subject on the SAME day!
            const alreadyHasSubjToday = PERIODS.some(p => classGrid[ck][day][p]?.subjectCode === item.subjectCode);
            if (alreadyHasSubjToday) continue;

            // Sort candidate blocks: if Tough, avoid Period 7
            const sortedBlocks = [...candidateBlocks].sort((b1, b2) => {
              if (item.difficulty === "Tough") {
                const b1P7 = b1.periods.includes(7) ? 100 : 0;
                const b2P7 = b2.periods.includes(7) ? 100 : 0;
                if (b1P7 !== b2P7) return b1P7 - b2P7;
              }
              return 0;
            });

            for (const block of sortedBlocks) {
              const classFree = block.periods.every(p => classGrid[ck][day][p] === null);
              if (!classFree) continue;

              const allFacsFree = facs.every(f => 
                block.periods.every(p => isFacultyFree(f, day, p))
              );
              if (!allFacsFree) continue;

              // Place the continuous block!
              block.periods.forEach(p => {
                classGrid[ck][day][p] = {
                  period: p,
                  time: timings[p] || DEFAULT_TIMINGS[p],
                  subjectCode: item.subjectCode,
                  subjectName: item.subjectName,
                  shortName: item.shortName || item.subjectCode,
                  facultyName: facs.join(", "),
                  facultyNames: facs,
                  type: item.type || "Theory",
                  difficulty: item.difficulty || "Normal",
                  isTraining: !!item.isTraining,
                  room: item.isTraining ? "Training Hall / LH-1" : "LH-1"
                };
                facs.forEach(f => markFacultyBusy(f, day, p, ck));
              });

              item.placedBlocksHours += blockDur;
              item.placedBlockDays.push(day);
              blockPlaced = true;
              break;
            }
          }
        }
      });
    });

    // --- STEP B: PLACE THEORY, SEMINAR, LIBRARY, & CUSTOM SUBJECTS ---
    // Uses Round-Robin Interleaving + Period Diversity Penalty + Faculty 1st Hour Protection
    classKeys.forEach(ck => {
      const classTheory = [];

      classGroups[ck].allocations.forEach(a => {
        const pat = (a.slotPattern || "").trim().toLowerCase();
        // If standard monolithic lab without custom pattern, skip
        if (isBlockType(a.type) && (!pat || pat === "regular" || pat === "3" || pat === "3h" || pat === "block")) {
          return;
        }

        const placedHours = a.placedBlocksHours || 0;
        const totalNeeded = Number(a.hoursPerWeek) || 4;
        const remainingSingleHours = Math.max(0, totalNeeded - placedHours);

        if (remainingSingleHours > 0) {
          classTheory.push({
            ...(a.toObject ? a.toObject() : a),
            requiredHours: remainingSingleHours,
            hoursAssigned: (a.advisorHourPlaced && placedHours === 0) ? 1 : 0
          });
        }
      });

      // Round-robin distribution: Assign 1 hour per subject per round
      let assignedInRound = true;
      while (assignedInRound) {
        assignedInRound = false;

        // Shuffle subject order each round so no single subject dominates the best slots
        const roundSubjs = [...classTheory].sort(() => Math.random() - 0.5);

        for (const subj of roundSubjs) {
          if (subj.hoursAssigned >= subj.requiredHours) continue;

          const fac = (subj.facultyNames && subj.facultyNames.length > 0) ? subj.facultyNames[0] : "";
          const candidateSlots = [];

          DAYS.forEach(day => {
            PERIODS.forEach(p => {
              // 1. Must be free in class and faculty free (Zero Clash!)
              if (classGrid[ck][day][p] !== null) return;
              if (fac && !isFacultyFree(fac, day, p)) return;

              // 2. Class constraint: No same theory subject back-to-back in consecutive periods!
              const leftSlot = p > 1 ? classGrid[ck][day][p - 1] : null;
              const rightSlot = p < 7 ? classGrid[ck][day][p + 1] : null;
              if ((leftSlot && leftSlot.subjectCode === subj.subjectCode) || (rightSlot && rightSlot.subjectCode === subj.subjectCode)) {
                return;
              }

              // Calculate penalty score (lower score is better)
              let score = 0;

              // Rule 1: Avoid 3 or more continuous periods for faculty (Faculty fatigue protection)
              if (fac && causesFacultyContinuousFatigue(fac, day, p)) {
                score += 6000;
              }

              // Rule 2: Balance daily faculty load (avoid piling 4-5 hours onto 1 day)
              if (fac) {
                const dailyHours = getFacultyDailyHours(fac, day);
                if (dailyHours >= 4) {
                  score += 3000;
                } else if (dailyHours >= 3) {
                  score += 1000;
                } else {
                  score += dailyHours * 80;
                }
              }

              // Rule 3: Prefer isolated periods with rest/prep breaks for faculty
              if (fac && hasAdjacentFacultyHour(fac, day, p)) {
                score += 50;
              }

              // 🎯 Rule 4: HARD BAN ON SAME THEORY SUBJECT OCCURRING TWICE ON THE SAME DAY!
              const classHoursOfThisSubjToday = PERIODS.filter(pr => 
                classGrid[ck][day][pr] && classGrid[ck][day][pr].subjectCode === subj.subjectCode
              ).length;
              if (classHoursOfThisSubjToday >= 1) {
                return; // Strictly reject: Never allow the same subject twice on the same day in Step B!
              }

              // 🎯 Rule 5: SUBJECT PERIOD DIVERSITY ACROSS DAYS (Stops PBS / WD / HCI from repeating in Period 1/2/3 every day!)
              const subjSamePeriod = getSubjectPeriodCount(ck, subj.subjectCode, p);
              if (subjSamePeriod >= 1) {
                score += subjSamePeriod * 3500;
              }

              // 🎯 Rule 6: FACULTY DAILY 1ST HOUR PROTECTION & PERIOD DIVERSITY
              if (fac) {
                const facPeriod1Count = getFacultyPeriodCount(fac, 1);
                if (p === 1 && facPeriod1Count >= 1) {
                  score += facPeriod1Count * 3000; // Strong penalty: Prevents faculty from having 1st hour every day!
                }

                const facSamePeriodCount = getFacultyPeriodCount(fac, p);
                if (facSamePeriodCount >= 1) {
                  score += facSamePeriodCount * 1200; // Prevents faculty from having the exact same period across days
                }
              }

              // 🎯 Rule 7: Morning vs Afternoon Balance for Subject
              const morningCount = getSubjectMorningCount(ck, subj.subjectCode);
              const afternoonCount = getSubjectAfternoonCount(ck, subj.subjectCode);
              if (p <= 4 && morningCount >= 3) {
                score += 400; // Encourage afternoon slot
              }
              if (p >= 5 && afternoonCount >= 2) {
                score += 300; // Encourage morning slot
              }

              // 🎯 Rule 8: Tie-Breaker Jitter (Prevents deterministic vertical column stacking)
              const jitter = Math.floor(Math.random() * 60);
              score += jitter;

              // 🎯 Rule 9: COGNITIVE LOAD & DIFFICULTY (Maths/Tough strictly avoids Period 7; Light in Afternoon)
              const diff = subj.difficulty || "Normal";
              if (diff === "Tough") {
                if (p === 7) {
                  score += 99999; // Strict block: 7th hour Maths / Tough is forbidden
                } else if (p === 6) {
                  score += 8000; // Strong penalty: avoid late afternoon fatigue for analytical subjects
                } else if (p <= 3) {
                  score -= 400; // Fresh morning minds priority bonus (Periods 1, 2, 3)
                }
              } else if (diff === "Light") {
                if (p >= 6) {
                  score -= 500; // Prefer late afternoon slots for lighter subjects
                } else if (p === 5) {
                  score -= 300;
                } else if (p <= 3) {
                  score += 1500; // Keep early morning for core subjects
                }
              } else {
                if (p === 7) {
                  score += 150; // Slight penalty to leave P7 open for light subjects or free hours
                }
              }

              candidateSlots.push({ day, period: p, score });
            });
          });

          if (candidateSlots.length > 0) {
            // Sort candidate slots by lowest score
            candidateSlots.sort((a, b) => a.score - b.score);
            const bestSlot = candidateSlots[0];

            const { day, period: p } = bestSlot;
            const diff = subj.difficulty || "Normal";
            classGrid[ck][day][p] = {
              period: p,
              time: timings[p] || DEFAULT_TIMINGS[p],
              subjectCode: subj.subjectCode,
              subjectName: subj.subjectName,
              shortName: subj.shortName || subj.subjectCode,
              facultyName: fac,
              facultyNames: fac ? [fac] : [],
              type: subj.type || "Theory",
              difficulty: diff,
              room: subj.type === "Library" ? "Library" : (subj.type === "Seminar" ? "Seminar Hall" : "LH-1")
            };
            if (fac) markFacultyBusy(fac, day, p, ck);
            subj.hoursAssigned++;
            assignedInRound = true;
          }
        }
      }

      // Check for unplaced theory hours
      classTheory.forEach(subj => {
        if (subj.hoursAssigned < subj.requiredHours) {
          unplacedTheory.push({
            classKey: ck,
            subject: subj.subjectName,
            faculty: (subj.facultyNames && subj.facultyNames[0]) || "",
            assigned: subj.hoursAssigned,
            required: subj.requiredHours
          });
        }
      });
    });

    // --- STEP C: FILL REMAINING EMPTY PERIODS AS FREE/LIBRARY/SEMINAR ---
    classKeys.forEach(ck => {
      DAYS.forEach(day => {
        PERIODS.forEach(p => {
          if (classGrid[ck][day][p] === null) {
            classGrid[ck][day][p] = {
              period: p,
              time: timings[p] || DEFAULT_TIMINGS[p],
              subjectCode: "FREE",
              subjectName: "Library / Mentoring",
              shortName: "LIB/SEM",
              facultyName: "-",
              facultyNames: [],
              type: "Free",
              difficulty: "Light",
              room: "Library"
            };
          }
        });
      });
    });

    // 4. Format Output for Frontend & Database
    const finalClasses = classKeys.map(ck => {
      const grp = classGroups[ck];
      const daysObj = {};
      DAYS.forEach(day => {
        daysObj[day] = PERIODS.map(p => classGrid[ck][day][p]);
      });
      return {
        classKey: ck,
        year: grp.year,
        semester: grp.semester,
        section: grp.section,
        days: daysObj
      };
    });

    // 5. Generate Faculty Schedule Views (Each faculty's weekly clash-free routine)
    const facultySchedules = {};
    const allStaffMembers = await Staff.find({ department });
    allStaffMembers.forEach(s => {
      facultySchedules[s.name] = {
        name: s.name,
        designation: s.designation,
        theoryCount: 0,
        labCount: 0,
        totalHours: 0,
        days: {
          Monday: [],
          Tuesday: [],
          Wednesday: [],
          Thursday: [],
          Friday: []
        }
      };
      DAYS.forEach(day => {
        facultySchedules[s.name].days[day] = PERIODS.map(p => ({
          period: p,
          time: timings[p] || DEFAULT_TIMINGS[p],
          occupied: false,
          classKey: "",
          subjectName: "",
          type: "Free"
        }));
      });
    });

    // Populate faculty schedule from classGrid
    finalClasses.forEach(cls => {
      DAYS.forEach(day => {
        cls.days[day].forEach(slot => {
          if (slot.type === "Free") return;
          const facList = slot.facultyNames && slot.facultyNames.length > 0 ? slot.facultyNames : (slot.facultyName ? [slot.facultyName] : []);
          facList.forEach(fac => {
            if (!facultySchedules[fac]) {
              facultySchedules[fac] = {
                name: fac,
                designation: "Faculty",
                theoryCount: 0,
                labCount: 0,
                totalHours: 0,
                days: { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] }
              };
              DAYS.forEach(d => {
                facultySchedules[fac].days[d] = PERIODS.map(p => ({
                  period: p,
                  time: timings[p] || DEFAULT_TIMINGS[p],
                  occupied: false,
                  classKey: "",
                  subjectName: "",
                  type: "Free"
                }));
              });
            }
            const periodIdx = slot.period - 1;
            facultySchedules[fac].days[day][periodIdx] = {
              period: slot.period,
              time: slot.time,
              occupied: true,
              classKey: cls.classKey,
              subjectName: slot.subjectName,
              shortName: slot.shortName,
              type: slot.type
            };
            facultySchedules[fac].totalHours++;
          });
        });
      });
    });

    // Calculate unique Theory count & Lab count per faculty (User's specific requirement!)
    allocations.forEach(item => {
      const facs = item.facultyNames || [];
      facs.forEach(fac => {
        if (facultySchedules[fac]) {
          if (item.type === "Theory") facultySchedules[fac].theoryCount++;
          if (item.type === "Lab") facultySchedules[fac].labCount++;
        }
      });
    });

    // 6. Save or update generated timetable in MongoDB
    await TimetableSchedule.findOneAndUpdate(
      { department, academicYear, semesterType },
      { department, academicYear, semesterType, classes: finalClasses, periodTimings: timings, isLocked: false, generatedAt: new Date() },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      department,
      academicYear,
      semesterType,
      classes: finalClasses,
      facultySchedules,
      unplacedLabs,
      unplacedTheory,
      message: "Clash-Free Timetable Generated Successfully!"
    });
  } catch (err) {
    console.error("Timetable Generation Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET saved timetable schedule
router.get("/schedule", async (req, res) => {
  try {
    const { department = "CSE", academicYear = "2026-2027", semesterType = "Odd" } = req.query;
    const schedule = await TimetableSchedule.findOne({ department, academicYear, semesterType });
    res.json(schedule || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE specific cell in schedule (Manual override)
router.put("/schedule/cell", async (req, res) => {
  try {
    const { department = "CSE", academicYear = "2026-2027", semesterType = "Odd", classKey, day, period, updatedSlot } = req.body;
    const doc = await TimetableSchedule.findOne({ department, academicYear, semesterType });
    if (!doc) return res.status(404).json({ error: "Schedule not found" });

    // Check if locked
    if (doc.isLocked) {
      return res.status(400).json({ error: "Timetable is LOCKED (Finalized)! Please unlock it before editing slots." });
    }

    const cls = doc.classes.find(c => c.classKey === classKey);
    if (!cls || !cls.days[day]) return res.status(404).json({ error: "Class or Day not found" });

    const pIdx = cls.days[day].findIndex(p => p.period === Number(period));
    if (pIdx !== -1) {
      cls.days[day][pIdx] = { ...cls.days[day][pIdx], ...updatedSlot };
      doc.markModified("classes");
      await doc.save();

      // Recalculate facultySchedules
      const allStaffMembers = await Staff.find({ department });
      const facultySchedules = {};
      allStaffMembers.forEach(s => {
        facultySchedules[s.name] = {
          name: s.name,
          designation: s.designation,
          theoryCount: 0,
          labCount: 0,
          totalHours: 0,
          days: { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] }
        };
        DAYS.forEach(d => {
          facultySchedules[s.name].days[d] = PERIODS.map(p => ({
            period: p,
            time: DEFAULT_TIMINGS[p],
            occupied: false,
            classKey: "",
            subjectName: "",
            type: "Free"
          }));
        });
      });

      doc.classes.forEach(cItem => {
        DAYS.forEach(d => {
          (cItem.days[d] || []).forEach(slot => {
            if (slot.type === "Free") return;
            const facList = slot.facultyNames && slot.facultyNames.length > 0 ? slot.facultyNames : (slot.facultyName ? [slot.facultyName] : []);
            facList.forEach(fac => {
              if (facultySchedules[fac]) {
                const periodIdx = slot.period - 1;
                if (facultySchedules[fac].days[d] && facultySchedules[fac].days[d][periodIdx]) {
                  facultySchedules[fac].days[d][periodIdx] = {
                    period: slot.period,
                    time: slot.time,
                    occupied: true,
                    classKey: cItem.classKey,
                    subjectName: slot.subjectName,
                    shortName: slot.shortName,
                    type: slot.type
                  };
                  facultySchedules[fac].totalHours++;
                }
              }
            });
          });
        });
      });

      return res.json({ success: true, schedule: doc, facultySchedules, message: "Slot updated successfully!" });
    }
    res.status(400).json({ error: "Period slot not found" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 5. LOCK & VERSION HISTORY ROUTES
// ==========================================

// LOCK or UNLOCK Timetable Schedule
router.put("/lock", async (req, res) => {
  try {
    const { department = "CSE", academicYear = "2026-2027", semesterType = "Odd", isLocked, lockedBy } = req.body;
    const doc = await TimetableSchedule.findOneAndUpdate(
      { department, academicYear, semesterType },
      { 
        isLocked: Boolean(isLocked), 
        lockedBy: lockedBy || "Admin", 
        lockedAt: isLocked ? new Date() : null 
      },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: "Timetable schedule not found to lock." });
    res.json({ success: true, isLocked: doc.isLocked, doc, message: doc.isLocked ? "Timetable Locked (Finalized) Successfully! 🔒" : "Timetable Unlocked! 🔓" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET all History Versions
router.get("/history", async (req, res) => {
  try {
    const { department = "CSE", academicYear = "2026-2027", semesterType = "Odd" } = req.query;
    const history = await TimetableHistory.find({ department, academicYear, semesterType }).sort({ generatedAt: -1 });
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// RESTORE a History Version to active TimetableSchedule
router.post("/history/restore/:id", async (req, res) => {
  try {
    const histDoc = await TimetableHistory.findById(req.params.id);
    if (!histDoc) return res.status(404).json({ error: "Version not found" });

    // Check if currently active is locked
    const currentActive = await TimetableSchedule.findOne({
      department: histDoc.department,
      academicYear: histDoc.academicYear,
      semesterType: histDoc.semesterType
    });

    if (currentActive && currentActive.isLocked) {
      return res.status(400).json({ error: "Cannot restore while current timetable is LOCKED! Please unlock first." });
    }

    // Auto-archive the current active one before restoring
    if (currentActive && currentActive.classes && currentActive.classes.length > 0) {
      const histCount = await TimetableHistory.countDocuments({
        department: histDoc.department,
        academicYear: histDoc.academicYear,
        semesterType: histDoc.semesterType
      });
      const dtStr = new Date(currentActive.generatedAt || Date.now()).toLocaleDateString("en-IN", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
      });
      await TimetableHistory.create({
        department: histDoc.department,
        academicYear: histDoc.academicYear,
        semesterType: histDoc.semesterType,
        versionName: `Version ${histCount + 1} (Pre-Restore ${dtStr})`,
        classes: currentActive.classes,
        isLocked: currentActive.isLocked || false,
        generatedAt: currentActive.generatedAt || new Date()
      });
    }

    // Restore classes from history into TimetableSchedule
    const updatedSchedule = await TimetableSchedule.findOneAndUpdate(
      { department: histDoc.department, academicYear: histDoc.academicYear, semesterType: histDoc.semesterType },
      {
        department: histDoc.department,
        academicYear: histDoc.academicYear,
        semesterType: histDoc.semesterType,
        classes: histDoc.classes,
        isLocked: false,
        generatedAt: new Date()
      },
      { upsert: true, new: true }
    );

    res.json({ 
      success: true, 
      message: `Restored ${histDoc.versionName || "Historical Version"} Successfully!`, 
      schedule: updatedSchedule 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE a History Version
router.delete("/history/:id", async (req, res) => {
  try {
    await TimetableHistory.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "History version removed successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE & APPLY PERIOD TIMINGS ACROSS ALL TIMETABLES
router.put("/timings", async (req, res) => {
  try {
    const { department = "CSE", academicYear = "2026-2027", semesterType = "Odd", timings } = req.body;
    if (!timings || typeof timings !== "object") {
      return res.status(400).json({ error: "Invalid period timings provided" });
    }

    // 1. Save in TimetableAllocation
    const alloc = await TimetableAllocation.findOneAndUpdate(
      { department, academicYear, semesterType },
      { periodTimings: timings, updatedAt: new Date() },
      { upsert: true, new: true }
    );

    // 2. Also update current active TimetableSchedule slots so all classes immediately reflect the new timings!
    const schedule = await TimetableSchedule.findOne({ department, academicYear, semesterType });
    if (schedule && schedule.classes) {
      schedule.classes.forEach(cItem => {
        DAYS.forEach(d => {
          (cItem.days[d] || []).forEach(slot => {
            if (timings[slot.period]) {
              slot.time = timings[slot.period];
            }
          });
        });
      });
      schedule.periodTimings = timings;
      schedule.markModified("classes");
      schedule.markModified("periodTimings");
      await schedule.save();
    }

    res.json({ 
      success: true, 
      message: "Admin period timings saved and applied across all classes and schedules!", 
      timings,
      schedule 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET Period Timings
router.get("/timings", async (req, res) => {
  try {
    const { department = "CSE", academicYear = "2026-2027", semesterType = "Odd" } = req.query;
    const alloc = await TimetableAllocation.findOne({ department, academicYear, semesterType });
    const timings = (alloc && alloc.periodTimings && Object.keys(alloc.periodTimings).length > 0)
      ? alloc.periodTimings
      : DEFAULT_TIMINGS;
    res.json(timings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
