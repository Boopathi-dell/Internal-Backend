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

// UPDATE a staff member (with automatic cascade to Allocations and Timetable Schedule)
router.put("/staff/:id", async (req, res) => {
  try {
    const { name, staffCode, email, department, designation, maxHoursPerWeek, maxTheory, maxLab, phone } = req.body;
    const oldStaff = await Staff.findById(req.params.id);
    if (!oldStaff) return res.status(404).json({ error: "Staff not found" });

    const oldName = oldStaff.name ? oldStaff.name.trim() : "";
    const newName = name ? name.trim() : oldName;

    const updateData = {};
    if (name) updateData.name = newName;
    if (staffCode !== undefined) updateData.staffCode = staffCode;
    if (email !== undefined) updateData.email = email;
    if (department) updateData.department = department.toUpperCase();
    if (designation) updateData.designation = designation;
    if (maxHoursPerWeek !== undefined) updateData.maxHoursPerWeek = Number(maxHoursPerWeek);
    if (maxTheory !== undefined) updateData.maxTheory = Number(maxTheory);
    if (maxLab !== undefined) updateData.maxLab = Number(maxLab);
    if (phone !== undefined) updateData.phone = phone;

    const staff = await Staff.findByIdAndUpdate(req.params.id, updateData, { new: true });

    // CASCADE: If staff name was changed, immediately update in ALL TimetableAllocation & TimetableSchedule documents
    if (oldName && newName && oldName !== newName) {
      // 1. Cascade in TimetableAllocation
      const allAllocDocs = await TimetableAllocation.find({});
      for (const aDoc of allAllocDocs) {
        let modified = false;
        (aDoc.allocations || []).forEach(item => {
          if (item.facultyName === oldName) {
            item.facultyName = newName;
            modified = true;
          }
          if (Array.isArray(item.facultyNames)) {
            const mapped = item.facultyNames.map(f => f === oldName ? newName : f);
            if (mapped.some((f, idx) => f !== item.facultyNames[idx])) {
              item.facultyNames = mapped;
              modified = true;
            }
          }
        });
        if (aDoc.classAdvisors) {
          Object.keys(aDoc.classAdvisors).forEach(ck => {
            if (aDoc.classAdvisors[ck] === oldName) {
              aDoc.classAdvisors[ck] = newName;
              modified = true;
            }
          });
        }
        if (modified) {
          aDoc.markModified("allocations");
          aDoc.markModified("classAdvisors");
          await aDoc.save();
        }
      }

      // 2. Cascade in TimetableSchedule
      const allSchedDocs = await TimetableSchedule.find({});
      for (const sDoc of allSchedDocs) {
        let modified = false;
        (sDoc.classes || []).forEach(cls => {
          DAYS.forEach(d => {
            (cls.days[d] || []).forEach(slot => {
              if (slot.facultyName === oldName) {
                slot.facultyName = newName;
                modified = true;
              }
              if (Array.isArray(slot.facultyNames)) {
                const mapped = slot.facultyNames.map(f => f === oldName ? newName : f);
                if (mapped.some((f, idx) => f !== slot.facultyNames[idx])) {
                  slot.facultyNames = mapped;
                  slot.facultyName = mapped.join(", ");
                  modified = true;
                }
              }
            });
          });
        });
        if (modified) {
          sDoc.markModified("classes");
          await sDoc.save();
        }
      }
    }

    res.json(staff);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// REPLACE FACULTY NAME GLOBALLY (across Staff, Allocations, Schedule, History)
router.post("/staff/replace-name", async (req, res) => {
  try {
    const { fromName, toName, department = "CSE" } = req.body;
    if (!fromName || !toName) {
      return res.status(400).json({ error: "fromName and toName are required" });
    }
    const cleanFrom = fromName.trim();
    const cleanTo = toName.trim();

    // 1. Update in Staff collection
    await Staff.updateMany({ name: cleanFrom }, { $set: { name: cleanTo } });

    // 2. Update in all TimetableAllocation docs
    const allocDocs = await TimetableAllocation.find({});
    for (const doc of allocDocs) {
      let modified = false;
      (doc.allocations || []).forEach(a => {
        if (a.facultyName === cleanFrom) {
          a.facultyName = cleanTo;
          modified = true;
        }
        if (Array.isArray(a.facultyNames)) {
          const newNames = a.facultyNames.map(f => f === cleanFrom ? cleanTo : f);
          if (newNames.some((f, idx) => f !== a.facultyNames[idx])) {
            a.facultyNames = newNames;
            modified = true;
          }
        }
      });
      if (doc.classAdvisors) {
        Object.keys(doc.classAdvisors).forEach(ck => {
          if (doc.classAdvisors[ck] === cleanFrom) {
            doc.classAdvisors[ck] = cleanTo;
            modified = true;
          }
        });
      }
      if (modified) {
        doc.markModified("allocations");
        doc.markModified("classAdvisors");
        await doc.save();
      }
    }

    // 3. Update in all TimetableSchedule docs
    const schedDocs = await TimetableSchedule.find({});
    for (const sDoc of schedDocs) {
      let modified = false;
      (sDoc.classes || []).forEach(cls => {
        DAYS.forEach(d => {
          (cls.days[d] || []).forEach(slot => {
            if (slot.facultyName === cleanFrom) {
              slot.facultyName = cleanTo;
              modified = true;
            }
            if (Array.isArray(slot.facultyNames)) {
              const newNames = slot.facultyNames.map(f => f === cleanFrom ? cleanTo : f);
              if (newNames.some((f, idx) => f !== slot.facultyNames[idx])) {
                slot.facultyNames = newNames;
                slot.facultyName = newNames.join(", ");
                modified = true;
              }
            }
          });
        });
      });
      if (modified) {
        sDoc.markModified("classes");
        await sDoc.save();
      }
    }

    res.json({
      success: true,
      message: `Replaced faculty name '${cleanFrom}' with '${cleanTo}' across all staff, allocations, and schedule slots!`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
        // Sanitize and normalize facultyNames array
        if (!Array.isArray(a.facultyNames)) {
          a.facultyNames = a.facultyName ? [String(a.facultyName).trim()] : [];
        } else {
          a.facultyNames = a.facultyNames.map(f => String(f || "").trim()).filter(Boolean);
          if (a.facultyNames.length === 0 && a.facultyName) {
            a.facultyNames = [String(a.facultyName).trim()];
          }
        }

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
      // Note: Lunch break is between Period 4 and Period 5 (01:00 - 01:45 PM), so p=4 and p=5 are separated by lunch
      const left1 = p > 1 && p !== 5 && !isFacultyFree(facultyName, day, p - 1);
      const left2 = p > 2 && p !== 5 && (p - 1) !== 5 && !isFacultyFree(facultyName, day, p - 2);
      if (left1 && left2) return true;

      const right1 = p < 7 && p !== 4 && !isFacultyFree(facultyName, day, p + 1);
      const right2 = p < 6 && p !== 4 && (p + 1) !== 4 && !isFacultyFree(facultyName, day, p + 2);
      if (right1 && right2) return true;

      if (left1 && right1) return true;

      return false;
    };

    // Helper: Checks if placing a multi-period continuous block causes >= 3 consecutive hours or excessive load for that faculty
    const wouldCauseFacultyBlockFatigue = (facultyName, day, blockPeriods) => {
      if (!facultyName) return false;
      const minP = Math.min(...blockPeriods);
      const maxP = Math.max(...blockPeriods);

      // 1. If block itself is >= 2 hours, faculty CANNOT teach adjacent period without break!
      // (Except across lunch break between Period 4 and Period 5)
      if (minP > 1 && minP !== 5 && !isFacultyFree(facultyName, day, minP - 1)) {
        return true; // Left adjacency: e.g. already teaching Period 2, and block is [3, 4] -> 4 consecutive hours!
      }

      if (maxP < 7 && maxP !== 4 && !isFacultyFree(facultyName, day, maxP + 1)) {
        return true; // Right adjacency: e.g. block is [1, 2], and already teaching Period 3 -> 3 or 4 consecutive hours!
      }

      // If block is an Afternoon Lab/Block starting at Period 5, faculty MUST NOT teach Period 4 right before lunch!
      if (minP === 5 && !isFacultyFree(facultyName, day, 4)) {
        return true; // Give faculty proper rest before conducting a long afternoon session
      }

      // 2. Daily fatigue check: Faculty should not exceed 4 total teaching hours on any single day
      const daily = getFacultyDailyHours(facultyName, day);
      if (daily + blockPeriods.length > 4) {
        return true; // Avoids overloading faculty on 1 day when other days of the week are free
      }

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

    // Helper: Checks if class already has a Lab / Laboratory on a given day (Enforces MAX 1 LAB PER CLASS PER DAY)
    const hasLabOnDay = (classKey, day) => {
      return PERIODS.some(p => {
        const slot = classGrid[classKey][day][p];
        return slot && isBlockType(slot.type);
      });
    };

    // Helper: Checks if faculty already conducts any Lab / Laboratory on a given day across any class (Enforces MAX 1 LAB PER FACULTY PER DAY)
    const doesFacultyHaveLabOnDay = (facultyName, day) => {
      if (!facultyName || !facultyBusy[facultyName] || !facultyBusy[facultyName][day]) return false;
      return PERIODS.some(p => {
        const ck = facultyBusy[facultyName][day][p];
        if (!ck) return false;
        const slot = classGrid[ck] && classGrid[ck][day] && classGrid[ck][day][p];
        return slot && isBlockType(slot.type);
      });
    };

    // Helper: Checks if subject is pure Core Theory (NO lab, seminar, library, mentoring, free)
    const isPureTheorySubject = (item) => {
      if (!item) return false;
      const t = (item.type || "").toLowerCase();
      const n = (item.subjectName || "").toLowerCase();
      const s = (item.shortName || "").toLowerCase();
      const c = (item.subjectCode || "").toLowerCase();

      if (t.includes("lab") || t.includes("project") || t.includes("seminar") || t.includes("sem") ||
          t.includes("lib") || t.includes("free") || t.includes("mentor") || t.includes("activity")) {
        return false;
      }
      if (n.includes("library") || n.includes("seminar") || n.includes("mentoring") ||
          s.includes("lib") || s.includes("sem") || c.includes("lib") || c.includes("sem") || c === "free") {
        return false;
      }
      return true;
    };

    // Helper: Checks if subject is Maths or Tough (Forbidden in Period 7)
    const isMathsOrToughSubject = (subj) => {
      if (!subj) return false;
      if (subj.difficulty === "Tough") return true;
      const str = `${subj.subjectName || ""} ${subj.shortName || ""} ${subj.subjectCode || ""}`.toLowerCase();
      return /math|algebra|calculus|discrete|probability|statistics|numerical|pbs|nm|dm|flat|toc|automata|compiler/i.test(str);
    };

    // Helper: Dynamic Candidate blocks for Lab based on hoursPerWeek (Supports 1-hr, 2-hr, 3-hr labs)
    // CRITICAL USER RULES:
    // 1. Labs must NEVER start in Period 1!
    // 2. Blocks must NEVER cross lunch break (between Period 4 and Period 5)!
    const getLabCandidateBlocks = (hours) => {
      const dur = Number(hours) || 3;
      if (dur === 2) {
        return [
          { name: "Afternoon (5-6)", periods: [5, 6] },
          { name: "Afternoon (6-7)", periods: [6, 7] },
          { name: "Morning (3-4)", periods: [3, 4] },
          { name: "Morning (2-3)", periods: [2, 3] }
          // STRICT: Period 1 is 100% EXCLUDED from Lab candidates!
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
          { name: "Afternoon (5-7)", periods: [5, 6, 7] }
        ];
      }
      // Standard 3 hours:
      return [
        { name: "Afternoon (5-7)", periods: [5, 6, 7] },
        { name: "Morning (2-4)", periods: [2, 3, 4] }
        // STRICT: [1, 2, 3] is 100% EXCLUDED from Lab candidates!
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
          { name: "Morning (2-4)", periods: [2, 3, 4] }
          // STRICT: Morning (1-3) removed so Period 1 stays open for 5 different core theory subjects!
        ];
      }
      if (dur === 2) {
        return [
          { name: "Morning (3-4)", periods: [3, 4] },
          { name: "Afternoon (5-6)", periods: [5, 6] },
          { name: "Afternoon (6-7)", periods: [6, 7] },
          { name: "Morning (2-3)", periods: [2, 3] }
          // STRICT: Morning (1-2) is 100% REMOVED! Multi-period blocks must NEVER seize Period 1!
        ];
      }
      return [
        { name: "Period 6", periods: [6] },
        { name: "Period 5", periods: [5] },
        { name: "Period 7", periods: [7] }
      ];
    };

    const unplacedLabs = [];
    const unplacedTheory = [];

    // --- STEP 0: CLASS ADVISOR SUBJECT ON MONDAY PERIOD 1 ---
    // User Requirement:
    // Monday first hour is NOT a dummy advisor hour.
    // If the advisor teaches a pure Core Theory subject in this class, schedule that real subject on Monday Period 1.
    // If the advisor does NOT teach a pure Theory subject in this class, do not insert any dummy hour!
    classKeys.forEach(ck => {
      const advisor = classAdvisors && classAdvisors[ck];
      if (!advisor) return;

      if (!isFacultyFree(advisor, "Monday", 1)) {
        return;
      }

      // Check if advisor teaches any pure core theory subject in this class (NEVER lab, seminar, or library)
      const classTheorySubjs = classGroups[ck].allocations.filter(a => isPureTheorySubject(a));
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
    // User Requirements:
    // 1. At most ONE Lab per class per day (If II-A has a lab today, another lab can only come another day!)
    // 2. Labs must NEVER start in Period 1! (Handled by getLabCandidateBlocks)
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

        // Distribute days across week: Prioritize days where this class has NO LAB and faculty has NO LAB today!
        const candidateDays = [...DAYS].sort((d1, d2) => {
          const hasLab1 = hasLabOnDay(ck, d1) ? 100 : 0;
          const hasLab2 = hasLabOnDay(ck, d2) ? 100 : 0;
          if (hasLab1 !== hasLab2) return hasLab1 - hasLab2;

          const facLab1 = facs.some(f => doesFacultyHaveLabOnDay(f, d1)) ? 150 : 0;
          const facLab2 = facs.some(f => doesFacultyHaveLabOnDay(f, d2)) ? 150 : 0;
          if (facLab1 !== facLab2) return facLab1 - facLab2;

          const c1 = getClassBlockCountOnDay(ck, d1);
          const c2 = getClassBlockCountOnDay(ck, d2);
          if (c1 !== c2) return c1 - c2;
          return Math.random() - 0.5;
        });

        for (let d = 0; d < candidateDays.length && !placed; d++) {
          const day = candidateDays[d];

          // STRICT REQUIREMENT: At most 1 Lab per class per day!
          // If this class already has a Lab on this day, skip to another day!
          if (hasLabOnDay(ck, day)) {
            continue;
          }

          // STRICT REQUIREMENT: At most 1 Lab per FACULTY per day! (A faculty cannot conduct 2 labs on the same day!)
          if (facs.some(f => doesFacultyHaveLabOnDay(f, day))) {
            continue;
          }

          // If this day already has >= 3 block periods, skip to a day with fewer blocks
          if (getClassBlockCountOnDay(ck, day) >= 3 && candidateDays.some(od => !hasLabOnDay(ck, od) && getClassBlockCountOnDay(ck, od) < 2)) {
            continue;
          }

          for (const block of candidateBlocks) {
            // Check if class is free for all periods in this block
            const classFree = block.periods.every(p => classGrid[ck][day][p] === null);
            if (!classFree) continue;

            // Check if ALL assigned faculties are free for all periods (CRITICAL ZERO CLASH & FATIGUE PROTECTION!)
            const allFacsFree = facs.every(f => 
              block.periods.every(p => isFacultyFree(f, day, p)) &&
              !wouldCauseFacultyBlockFatigue(f, day, block.periods)
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
          // 1. Not already containing this subject today in this class (strict skip)
          // 2. Faculty daily workload: Prioritize days where faculty currently has FEWEST hours!
          // 3. Alternate day spacing from previously placed blocks of this subject in this class
          // 4. Fewest existing blocks on that day in this class
          const candidateDays = [...DAYS].sort((d1, d2) => {
            const hasSubj1 = classGrid[ck][d1] && PERIODS.some(p => classGrid[ck][d1][p]?.subjectCode === item.subjectCode) ? 100 : 0;
            const hasSubj2 = classGrid[ck][d2] && PERIODS.some(p => classGrid[ck][d2][p]?.subjectCode === item.subjectCode) ? 100 : 0;
            if (hasSubj1 !== hasSubj2) return hasSubj1 - hasSubj2;

            // Prioritize days where faculty has fewer hours (balances faculty teaching across the whole week)
            if (facs.length > 0) {
              const facDaily1 = Math.max(...facs.map(f => getFacultyDailyHours(f, d1)));
              const facDaily2 = Math.max(...facs.map(f => getFacultyDailyHours(f, d2)));
              if (facDaily1 !== facDaily2) return facDaily1 - facDaily2;
            }

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

            // If item is a Lab / non-theory (e.g. CDS-III 2+1), enforce MAX 1 LAB PER CLASS & PER FACULTY PER DAY!
            if ((isBlockType(item.type) || !isPureTheorySubject(item))) {
              if (hasLabOnDay(ck, day)) continue;
              if (facs.some(f => doesFacultyHaveLabOnDay(f, day))) continue;
            }

            // Don't place two blocks of the SAME subject on the SAME day!
            const alreadyHasSubjToday = PERIODS.some(p => classGrid[ck][day][p]?.subjectCode === item.subjectCode);
            if (alreadyHasSubjToday) continue;

            // Score candidate blocks:
            // 1. Tough/Maths strictly avoids Period 7
            // 2. Period 1 strictly forbidden for non-theory/labs
            // 3. Faculty period repetition penalty (prevents faculty from having P3-4 every single day!)
            // 4. Class & Section morning/afternoon rotation (swaps Section A morning with Section B afternoon)
            const scoredBlocks = candidateBlocks.map(block => {
              let score = 0;

              // Maths/Tough avoids Period 7
              if (isMathsOrToughSubject(item)) {
                if (block.periods.includes(7)) score += 99999;
                if (block.periods.includes(6)) score += 8000;
              }

              // Non-theory strictly avoids Period 1
              if (!isPureTheorySubject(item) || isBlockType(item.type)) {
                if (block.periods.includes(1)) score += 99999;
              }

              // Faculty Period Diversity across the week (Prevents P3-4 vertical stacking)
              if (facs.length > 0) {
                facs.forEach(f => {
                  block.periods.forEach(p => {
                    const pCount = getFacultyPeriodCount(f, p);
                    if (pCount >= 2) {
                      score += pCount * 4500; // Heavy penalty: faculty must NOT teach same period 3+ times!
                    } else if (pCount === 1) {
                      score += 1600; // Moderate penalty to encourage morning/afternoon rotation
                    } else {
                      score -= 900; // Bonus to pick periods the faculty hasn't taught yet this week
                    }
                  });
                });
              }

              // Class Morning vs Afternoon balance for continuous blocks:
              const isMorning = block.periods.some(p => p <= 4);
              const classMorningBlocks = DAYS.filter(d => 
                classGrid[ck][d] && (classGrid[ck][d][3]?.isTraining || classGrid[ck][d][4]?.isTraining)
              ).length;
              const classAfternoonBlocks = DAYS.filter(d => 
                classGrid[ck][d] && (classGrid[ck][d][5]?.isTraining || classGrid[ck][d][6]?.isTraining)
              ).length;

              if (isMorning && classMorningBlocks > classAfternoonBlocks) {
                score += 1500; // Prefer afternoon to balance class schedule
              } else if (!isMorning && classAfternoonBlocks > classMorningBlocks) {
                score += 1500;
              }

              // Section rotation: If Section A has this subject in Morning, prefer Afternoon for Section B
              const sectionLetter = (classGroups[ck]?.section || "A").toUpperCase();
              if (sectionLetter === "B") {
                if (isMorning) score += 500;
                else score -= 500;
              }

              return { block, score };
            });

            scoredBlocks.sort((a, b) => a.score - b.score);
            const sortedBlocks = scoredBlocks.map(sb => sb.block);

            for (const block of sortedBlocks) {
              // STRICT: If block includes Period 7 and subject is Maths / Tough, HARD BAN!
              if (isMathsOrToughSubject(item) && block.periods.includes(7)) {
                continue;
              }

              // STRICT: Period 1 is ONLY for pure Core Theory! CDS-III, Labs, Seminars, Library are 100% FORBIDDEN from Period 1!
              if (block.periods.includes(1)) {
                if (!isPureTheorySubject(item) || isBlockType(item.type)) {
                  continue; // Labs and non-theory blocks are 100% FORBIDDEN from Period 1!
                }
                if (classGrid[ck][day][1] !== null || getSubjectPeriodCount(ck, item.subjectCode, 1) >= 1) {
                  continue;
                }
              }

              const classFree = block.periods.every(p => classGrid[ck][day][p] === null);
              if (!classFree) continue;

              // Check if ALL assigned faculties are free for all periods and no fatigue (>2 continuous hours)
              const allFacsFree = facs.every(f => 
                block.periods.every(p => isFacultyFree(f, day, p)) &&
                !wouldCauseFacultyBlockFatigue(f, day, block.periods)
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

      // Determine how many unique core theory subjects this class has
      const classUniqueTheoryCodes = new Set(
        classGroups[ck].allocations.filter(a => isPureTheorySubject(a)).map(a => a.subjectCode)
      );
      // If class has >= 5 core theory subjects, each subject can only appear in Period 1 ONCE across the 5 days (Mon-Fri)
      const maxAllowedP1PerSubject = classUniqueTheoryCodes.size >= 5 ? 1 : Math.ceil(5 / Math.max(1, classUniqueTheoryCodes.size));

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

              // 3. If subject is a Lab (e.g. single-hour remainder of CDS-III), enforce max 1 lab per day & no Period 1!
              if (isBlockType(subj.type)) {
                if (hasLabOnDay(ck, day)) return;
                if (p === 1) return;
              }

              // 🎯 Rule 1: PERIOD 1 STRICT RULES (Core Theory Only & 5 Different Subjects Mon-Fri)
              let score = 0;
              if (p === 1) {
                // HARD BAN: Only pure Core Theory allowed in Period 1 (NO Lab, Seminar, Library, Mentoring, Free)!
                if (!isPureTheorySubject(subj)) {
                  return;
                }

                // HARD BAN: 5 DAYS 5 DIFFERENT SUBJECTS in Period 1!
                // No subject may repeat in Period 1 if this class has >= 5 core theory subjects!
                if (getSubjectPeriodCount(ck, subj.subjectCode, 1) >= maxAllowedP1PerSubject) {
                  return;
                }

                // Faculty Period 1 rotation: Avoid giving Period 1 to the same faculty more than twice across classes
                if (fac && getFacultyPeriodCount(fac, 1) >= 2) {
                  score += 5000;
                }

                // Priority bonus: Eagerly fill empty Period 1 with this eligible fresh core theory subject!
                score -= 1500;
              }

              // 🎯 Rule 2: MATHS / TOUGH SUBJECTS NEVER IN PERIOD 7
              if (isMathsOrToughSubject(subj)) {
                if (p === 7) {
                  return; // HARD BAN: Maths / Tough subjects are strictly forbidden in Period 7!
                }
                if (p === 6) {
                  score += 8500; // Strong penalty: avoid late afternoon fatigue for analytical subjects
                }
                if (p <= 3) {
                  score -= 400; // Fresh morning minds priority bonus (Periods 1, 2, 3)
                }
              } else if (subj.difficulty === "Light") {
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

              // 🎯 Rule 3: STRICT BAN ON FACULTY CONTINUOUS FATIGUE (Never >= 3 continuous hours)
              if (fac && causesFacultyContinuousFatigue(fac, day, p)) {
                return; // Strictly reject: Never allow 3 or more continuous periods for faculty!
              }

              // STRICT: Avoid faculty teaching Period 4 right before an afternoon lab [5, 6, 7]
              if (fac && p === 4 && (!isFacultyFree(fac, day, 5) && !isFacultyFree(fac, day, 6))) {
                return;
              }

              // 🎯 Rule 4: Balance daily faculty load across the week
              if (fac) {
                const dailyHours = getFacultyDailyHours(fac, day);
                if (dailyHours >= 4) {
                  score += 6000;
                } else if (dailyHours >= 3) {
                  score += 2500;
                } else if (dailyHours === 0) {
                  score -= 500; // Bonus to distribute teaching to days where faculty has 0 hours
                } else {
                  score += dailyHours * 100;
                }
              }

              // Prefer isolated periods with rest/prep breaks for faculty
              if (fac && hasAdjacentFacultyHour(fac, day, p)) {
                score += 50;
              }

              // 🎯 Rule 5: HARD BAN ON SAME THEORY SUBJECT OCCURRING TWICE ON THE SAME DAY!
              const classHoursOfThisSubjToday = PERIODS.filter(pr => 
                classGrid[ck][day][pr] && classGrid[ck][day][pr].subjectCode === subj.subjectCode
              ).length;
              if (classHoursOfThisSubjToday >= 1) {
                return; // Strictly reject: Never allow the same subject twice on the same day in Step B!
              }

              // 🎯 Rule 6: SUBJECT PERIOD DIVERSITY ACROSS DAYS (Stops subjects from repeating in same period)
              const subjSamePeriod = getSubjectPeriodCount(ck, subj.subjectCode, p);
              if (subjSamePeriod >= 1) {
                score += subjSamePeriod * 3500;
              }

              // Faculty Period Diversity across days
              if (fac) {
                const facSamePeriodCount = getFacultyPeriodCount(fac, p);
                if (facSamePeriodCount >= 1) {
                  score += facSamePeriodCount * 1200; // Prevents faculty from having the exact same period across days
                }
              }

              // Morning vs Afternoon Balance for Subject
              const morningCount = getSubjectMorningCount(ck, subj.subjectCode);
              const afternoonCount = getSubjectAfternoonCount(ck, subj.subjectCode);
              if (p <= 4 && morningCount >= 3) {
                score += 400; // Encourage afternoon slot
              }
              if (p >= 5 && afternoonCount >= 2) {
                score += 300; // Encourage morning slot
              }

              // Tie-Breaker Jitter (Prevents deterministic vertical column stacking)
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

    // --- GUARANTEE PASS: Ensure Period 1 has a Core Theory Subject on all 5 days ---
    classKeys.forEach(ck => {
      DAYS.forEach(day => {
        if (classGrid[ck][day][1] === null) {
          const theoryCandidates = classGroups[ck].allocations.filter(a => isPureTheorySubject(a));
          for (const cand of theoryCandidates) {
            const fac = cand.facultyNames && cand.facultyNames.length > 0 ? cand.facultyNames[0] : "";
            if (fac && !isFacultyFree(fac, day, 1)) continue;
            if (fac && causesFacultyContinuousFatigue(fac, day, 1)) continue;

            classGrid[ck][day][1] = {
              period: 1,
              time: timings[1] || DEFAULT_TIMINGS[1],
              subjectCode: cand.subjectCode,
              subjectName: cand.subjectName,
              shortName: cand.shortName || cand.subjectCode,
              facultyName: fac,
              facultyNames: fac ? [fac] : [],
              type: "Theory",
              difficulty: cand.difficulty || "Normal",
              room: "LH-1"
            };
            if (fac) markFacultyBusy(fac, day, 1, ck);
            break;
          }
        }
      });
    });

    // --- STEP C: FILL REMAINING EMPTY PERIODS AS FREE / SELF STUDY ---
    // STRICT USER REQUIREMENT:
    // If the admin allocated 1 hour for LIB, LIB must appear EXACTLY 1 time! Never duplicate extra fake LIBs!
    // If the admin allocated 1 hour for SEM, SEM must appear EXACTLY 1 time!
    // Remaining unallocated periods are purely FREE / Self Study hours.
    classKeys.forEach(ck => {
      DAYS.forEach(day => {
        PERIODS.forEach(p => {
          if (classGrid[ck][day][p] === null) {
            classGrid[ck][day][p] = {
              period: p,
              time: timings[p] || DEFAULT_TIMINGS[p],
              subjectCode: "FREE",
              subjectName: "Free Period / Self Study",
              shortName: "FREE",
              facultyName: "-",
              facultyNames: [],
              type: "Free",
              difficulty: "Light",
              room: "-"
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

// SYNC FACULTY: Updates faculty names across all existing schedule slots without regenerating the timetable
router.post("/schedule/sync-faculty", async (req, res) => {
  try {
    const { department = "CSE", academicYear = "2026-2027", semesterType = "Odd", facultyNameReplacements, updatedAllocations } = req.body;
    const doc = await TimetableSchedule.findOne({ department, academicYear, semesterType });
    if (!doc) return res.status(404).json({ error: "Timetable schedule not found. Please generate timetable first." });

    // Load allocations (from request payload if passed, or from TimetableAllocation collection)
    let allocations = updatedAllocations;
    if (!allocations || !Array.isArray(allocations) || allocations.length === 0) {
      const allocDoc = await TimetableAllocation.findOne({ department, academicYear, semesterType });
      allocations = allocDoc ? allocDoc.allocations : [];
    }

    // Build lookup map for subject -> faculty
    const allocMap = {};
    (allocations || []).forEach(a => {
      if (!a) return;
      const codeKey = (a.subjectCode || "").trim().toUpperCase();
      const shortKey = (a.shortName || "").trim().toUpperCase();
      let facNames = a.facultyNames && a.facultyNames.length > 0 ? a.facultyNames : (a.facultyName ? [a.facultyName] : []);
      facNames = facNames.map(f => String(f || "").trim()).filter(Boolean);

      if (facNames.length > 0) {
        if (codeKey) {
          allocMap[`${a.year}-${a.section}-${codeKey}`] = facNames;
          allocMap[`${a.year}-${codeKey}`] = facNames;
        }
        if (shortKey) {
          allocMap[`${a.year}-${a.section}-${shortKey}`] = facNames;
          allocMap[`${a.year}-${shortKey}`] = facNames;
        }
      }
    });

    let updatedSlotsCount = 0;
    (doc.classes || []).forEach(cls => {
      DAYS.forEach(d => {
        (cls.days[d] || []).forEach(slot => {
          if (!slot || slot.type === "Free" || slot.subjectCode === "FREE") return;

          let slotUpdated = false;

          // 1. Direct name replacements (e.g. { "Balamurgan": "Balamurugan" })
          if (facultyNameReplacements && typeof facultyNameReplacements === "object") {
            if (slot.facultyName && facultyNameReplacements[slot.facultyName]) {
              slot.facultyName = facultyNameReplacements[slot.facultyName];
              slotUpdated = true;
            }
            if (Array.isArray(slot.facultyNames) && slot.facultyNames.length > 0) {
              const mapped = slot.facultyNames.map(f => facultyNameReplacements[f] || f);
              if (mapped.some((f, idx) => f !== slot.facultyNames[idx])) {
                slot.facultyNames = mapped;
                slot.facultyName = mapped.join(", ");
                slotUpdated = true;
              }
            }
          }

          // 2. Sync from latest allocations map
          const codeUpper = (slot.subjectCode || "").trim().toUpperCase();
          const shortUpper = (slot.shortName || "").trim().toUpperCase();
          const matchedFacs = allocMap[`${cls.year}-${cls.section}-${codeUpper}`] ||
                             allocMap[`${cls.year}-${cls.section}-${shortUpper}`] ||
                             allocMap[`${cls.year}-${codeUpper}`] ||
                             allocMap[`${cls.year}-${shortUpper}`];

          if (matchedFacs && matchedFacs.length > 0) {
            const newFacStr = matchedFacs.join(", ");
            if (slot.facultyName !== newFacStr) {
              slot.facultyNames = matchedFacs;
              slot.facultyName = newFacStr;
              slotUpdated = true;
            }
          }

          if (slotUpdated) updatedSlotsCount++;
        });
      });
    });

    doc.markModified("classes");
    await doc.save();

    // Recalculate facultySchedules for all staff
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
          time: (doc.periodTimings && doc.periodTimings[p]) || DEFAULT_TIMINGS[p] || "09:10-10:05",
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
          if (slot.type === "Free" || slot.subjectCode === "FREE") return;
          const facList = slot.facultyNames && slot.facultyNames.length > 0 ? slot.facultyNames : (slot.facultyName ? [slot.facultyName] : []);
          facList.forEach(fac => {
            const cleanFac = String(fac || "").trim();
            if (facultySchedules[cleanFac]) {
              const periodIdx = slot.period - 1;
              if (facultySchedules[cleanFac].days[d] && facultySchedules[cleanFac].days[d][periodIdx]) {
                facultySchedules[cleanFac].days[d][periodIdx] = {
                  period: slot.period,
                  time: slot.time,
                  occupied: true,
                  classKey: cItem.classKey,
                  subjectCode: slot.subjectCode,
                  subjectName: slot.subjectName,
                  shortName: slot.shortName,
                  type: slot.type,
                  room: slot.room
                };
              }
            }
          });
        });
      });
    });

    // Also persist faculty name replacements in TimetableAllocation
    let finalAllocations = allocations;
    if (facultyNameReplacements && typeof facultyNameReplacements === "object") {
      const aDoc = await TimetableAllocation.findOne({ department, academicYear, semesterType });
      if (aDoc) {
        let aModified = false;
        (aDoc.allocations || []).forEach(item => {
          if (item.facultyName && facultyNameReplacements[item.facultyName]) {
            item.facultyName = facultyNameReplacements[item.facultyName];
            aModified = true;
          }
          if (Array.isArray(item.facultyNames)) {
            const mapped = item.facultyNames.map(f => facultyNameReplacements[f] || f);
            if (mapped.some((f, idx) => f !== item.facultyNames[idx])) {
              item.facultyNames = mapped;
              aModified = true;
            }
          }
        });
        if (aModified) {
          aDoc.markModified("allocations");
          await aDoc.save();
          finalAllocations = aDoc.allocations;
        }
      }
    }

    res.json({
      success: true,
      message: `Faculty names updated successfully in timetable schedule! (${updatedSlotsCount} slots updated)`,
      classes: doc.classes,
      facultySchedules,
      allocations: finalAllocations
    });
  } catch (err) {
    console.error("Sync Faculty Route Error:", err);
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
