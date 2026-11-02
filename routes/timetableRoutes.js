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

    // Helper: Dynamic Candidate blocks for Lab based on hoursPerWeek (Supports 2-hr, 3-hr, 4-hr labs)
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
      if (dur === 4) {
        return [
          { name: "Morning (1-4)", periods: [1, 2, 3, 4] },
          { name: "Afternoon (4-7)", periods: [4, 5, 6, 7] }
        ];
      }
      // Standard 3 hours
      return [
        { name: "Afternoon (5-7)", periods: [5, 6, 7] },
        { name: "Morning (1-3)", periods: [1, 2, 3] },
        { name: "Midday (2-4)", periods: [2, 3, 4] }
      ];
    };

    const isBlockType = (type) => {
      const t = (type || "").toLowerCase();
      return t.includes("lab") || t.includes("project");
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
      const classLabs = classGroups[ck].allocations.filter(a => isBlockType(a.type));
      
      classLabs.forEach(lab => {
        let placed = false;
        const facs = lab.facultyNames || [];
        const labDuration = Number(lab.hoursPerWeek) || 3;
        const candidateBlocks = getLabCandidateBlocks(labDuration);

        // Distribute days across week (shuffle days so labs don't all cluster on Monday/Tuesday)
        const shuffledDays = [...DAYS].sort(() => Math.random() - 0.5);

        for (let d = 0; d < shuffledDays.length && !placed; d++) {
          const day = shuffledDays[d];

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

    // --- STEP B: PLACE THEORY, SEMINAR, LIBRARY, & CUSTOM SUBJECTS ---
    // Uses Round-Robin Interleaving + Period Diversity Penalty + Faculty 1st Hour Protection
    classKeys.forEach(ck => {
      const classTheory = classGroups[ck].allocations.filter(a => !isBlockType(a.type));
      
      // Initialize hours tracking for round-robin
      classTheory.forEach(subj => {
        subj.requiredHours = Number(subj.hoursPerWeek) || 4;
        subj.hoursAssigned = subj.advisorHourPlaced ? 1 : 0;
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

              // Rule 4: Class daily distribution: Avoid having the same subject twice on the same day
              const classHoursOfThisSubjToday = PERIODS.filter(pr => 
                classGrid[ck][day][pr] && classGrid[ck][day][pr].subjectCode === subj.subjectCode
              ).length;
              if (classHoursOfThisSubjToday >= 1) {
                score += 500 * classHoursOfThisSubjToday;
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

              candidateSlots.push({ day, period: p, score });
            });
          });

          if (candidateSlots.length > 0) {
            // Sort candidate slots by lowest score
            candidateSlots.sort((a, b) => a.score - b.score);
            const bestSlot = candidateSlots[0];

            const { day, period: p } = bestSlot;
            classGrid[ck][day][p] = {
              period: p,
              time: timings[p] || DEFAULT_TIMINGS[p],
              subjectCode: subj.subjectCode,
              subjectName: subj.subjectName,
              shortName: subj.shortName || subj.subjectCode,
              facultyName: fac,
              facultyNames: fac ? [fac] : [],
              type: subj.type || "Theory",
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
