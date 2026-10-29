const express = require("express");
const router = express.Router();
const Staff = require("../models/Staff");
const User = require("../models/User");
const SubjectMaster = require("../models/SubjectMaster");
const TimetableAllocation = require("../models/TimetableAllocation");
const TimetableSchedule = require("../models/TimetableSchedule");

// Period timing defaults
const DEFAULT_TIMINGS = {
  1: "09:00 - 09:50",
  2: "09:50 - 10:40",
  3: "11:00 - 11:50",
  4: "11:50 - 12:40",
  5: "01:30 - 02:20",
  6: "02:20 - 03:10",
  7: "03:10 - 04:00"
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
    const allocation = await TimetableAllocation.findOne({ department, academicYear, semesterType });
    res.json(allocation || { department, academicYear, semesterType, allocations: [] });
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
      classAdvisors
    } = req.body;

    const updateData = { department, academicYear, semesterType, allocations, updatedAt: new Date() };
    if (yearSections) updateData.yearSections = yearSections;
    if (classAdvisors) updateData.classAdvisors = classAdvisors;

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
      timings = DEFAULT_TIMINGS
    } = req.body;

    let classAdvisors = inputClassAdvisors;
    if (!classAdvisors || Object.keys(classAdvisors).length === 0) {
      const savedAlloc = await TimetableAllocation.findOne({ department, academicYear, semesterType });
      if (savedAlloc && savedAlloc.classAdvisors) {
        classAdvisors = savedAlloc.classAdvisors;
      } else {
        classAdvisors = {};
      }
    }

    if (!allocations || allocations.length === 0) {
      return res.status(400).json({ error: "No subject-staff allocations provided to generate timetable." });
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

    const isBlockType = (type) => {
      const t = (type || "").toLowerCase();
      return t.includes("lab") || t.includes("project");
    };

    const unplacedLabs = [];
    const unplacedTheory = [];

    // --- STEP 0: CLASS ADVISOR MONDAY PERIOD 1 RESERVATION ---
    // User Requirement: Class Advisor goes to Monday Period 1 for their designated class!
    classKeys.forEach(ck => {
      const advisor = classAdvisors && classAdvisors[ck];
      if (!advisor) return;

      if (!isFacultyFree(advisor, "Monday", 1)) {
        console.warn(`Class Advisor ${advisor} for ${ck} is already busy on Monday Period 1!`);
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
          isClassAdvisorHour: true
        };
        markFacultyBusy(advisor, "Monday", 1, ck);
        advisorSubj.advisorHourPlaced = true;
      } else {
        classGrid[ck]["Monday"][1] = {
          period: 1,
          time: timings[1] || DEFAULT_TIMINGS[1],
          subjectCode: "ADV",
          subjectName: "Class Advisor & Mentoring Hour",
          shortName: "ADVISOR",
          facultyName: advisor,
          facultyNames: [advisor],
          type: "Mentoring",
          room: "Classroom",
          isClassAdvisorHour: true
        };
        markFacultyBusy(advisor, "Monday", 1, ck);
      }
    });

    // --- STEP A: PLACE LAB & PROJECT SESSIONS FIRST (Contiguous 3-slot blocks) ---
    // Standard Lab candidate blocks: Periods [1, 2, 3] (morning) or [5, 6, 7] (afternoon)
    const labBlocks = [
      { name: "Morning", periods: [1, 2, 3] },
      { name: "Afternoon", periods: [5, 6, 7] }
    ];

    classKeys.forEach(ck => {
      const classLabs = classGroups[ck].allocations.filter(a => isBlockType(a.type));
      
      classLabs.forEach(lab => {
        let placed = false;
        const facs = lab.facultyNames || [];

        // Shuffle days or pick distinct days to spread across week
        for (let d = 0; d < DAYS.length && !placed; d++) {
          const day = DAYS[d];

          for (const block of labBlocks) {
            // Check if class is free for all 3 periods (Note: Monday [1, 2, 3] is blocked if Class Advisor is at Period 1)
            const classFree = block.periods.every(p => classGrid[ck][day][p] === null);
            if (!classFree) continue;

            // Check if ALL assigned faculties are free for all 3 periods (CRITICAL ZERO CLASH!)
            const allFacsFree = facs.every(f => 
              block.periods.every(p => isFacultyFree(f, day, p))
            );
            if (!allFacsFree) continue;

            // All free! Place Lab / Project
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
    // Avoid staff fatigue, avoid consecutive same-subjects for class, balance workload across week
    classKeys.forEach(ck => {
      const classTheory = classGroups[ck].allocations.filter(a => !isBlockType(a.type));
      
      // Sort subjects: higher hours or single faculty first
      classTheory.sort((a, b) => (b.hoursPerWeek || 4) - (a.hoursPerWeek || 4));

      classTheory.forEach(subj => {
        const requiredHours = subj.hoursPerWeek || 4;
        const fac = (subj.facultyNames && subj.facultyNames.length > 0) ? subj.facultyNames[0] : "";
        let hoursAssigned = subj.advisorHourPlaced ? 1 : 0;

        while (hoursAssigned < requiredHours) {
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

              // Rule A: Avoid 3 or more continuous periods for faculty (CRITICAL USER REQUEST!)
              if (fac && causesFacultyContinuousFatigue(fac, day, p)) {
                score += 5000;
              }

              // Rule B: Balance daily faculty load (avoid piling 4-5 hours onto 1 day)
              if (fac) {
                const dailyHours = getFacultyDailyHours(fac, day);
                if (dailyHours >= 4) {
                  score += 2500;
                } else if (dailyHours >= 3) {
                  score += 800;
                } else {
                  score += dailyHours * 60;
                }
              }

              // Rule C: Prefer isolated periods with rest/prep breaks for faculty
              if (fac && hasAdjacentFacultyHour(fac, day, p)) {
                score += 40;
              }

              // Rule D: Class distribution: Avoid having the same subject twice on the same day if possible
              const classHoursOfThisSubjToday = PERIODS.filter(pr => classGrid[ck][day][pr] && classGrid[ck][day][pr].subjectCode === subj.subjectCode).length;
              if (classHoursOfThisSubjToday >= 1) {
                score += 350;
              }

              candidateSlots.push({ day, period: p, score });
            });
          });

          if (candidateSlots.length === 0) {
            break;
          }

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
          hoursAssigned++;
        }

        if (hoursAssigned < requiredHours) {
          unplacedTheory.push({
            classKey: ck,
            subject: subj.subjectName,
            faculty: fac,
            assigned: hoursAssigned,
            required: requiredHours
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
      { department, academicYear, semesterType, classes: finalClasses, generatedAt: new Date() },
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

module.exports = router;
