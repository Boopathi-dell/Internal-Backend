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

// Edit distance calculation for minor typo tolerance
function editDistance(s1, s2) {
  const m = s1.length, n = s2.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) dp[i][j] = dp[i - 1][j - 1];
      else dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// Tokenizes a faculty name by stripping prefixes (Mr, Mrs, Dr, etc.) and separating into sorted word tokens
function cleanFacTokens(str) {
  if (!str) return [];
  return String(str)
    .toLowerCase()
    .replace(/\b(mr|mrs|ms|dr|prof|head|ta|ap)\b/gi, " ")
    .replace(/[^a-z0-9\s]/gi, " ")
    .split(/\s+/)
    .filter(t => t.length > 0)
    .sort();
}

// Normalizes a faculty name by stripping prefixes and non-alphanumerics
const cleanFacString = (str) => {
  if (!str) return "";
  return String(str)
    .toLowerCase()
    .replace(/\b(mr|mrs|ms|dr|prof|head|ta|ap)\b/gi, "")
    .replace(/[^a-z0-9]/gi, "")
    .trim();
};

// Robust comparison that matches:
// 1. Initial before vs after name: "Mrs.S.Priya" vs "Priya S" vs "S. Priya"
// 2. Prefixes: "Mr K.Ravikumar" vs "k.ravikumar" vs "Ravikumar"
// 3. Typo with same initials: "Mr.S.Balamurgan" vs "Balamurugan"
// 4. Protects distinct names like "Mrs.S.Priya" vs "Mrs.S.Haripriya" or "Mrs.S.Priyanka"
const isSameFacultyName = (nameA, nameB) => {
  if (!nameA || !nameB) return false;
  const a = String(nameA).trim().toLowerCase();
  const b = String(nameB).trim().toLowerCase();
  if (a === b) return true;

  const tokensA = cleanFacTokens(a);
  const tokensB = cleanFacTokens(b);
  if (tokensA.length === 0 || tokensB.length === 0) return false;

  const joinA = tokensA.join("_");
  const joinB = tokensB.join("_");
  if (joinA === joinB) return true;

  // Compare core names (tokens with length > 1, i.e. not single-letter initials)
  const coreA = tokensA.filter(t => t.length > 1);
  const coreB = tokensB.filter(t => t.length > 1);

  if (coreA.length > 0 && coreB.length > 0) {
    if (coreA.join("_") === coreB.join("_")) {
      // If initials also exist on both, ensure they don't clash
      const initA = tokensA.filter(t => t.length === 1);
      const initB = tokensB.filter(t => t.length === 1);
      if (initA.length > 0 && initB.length > 0 && initA.join("") !== initB.join("")) {
        return false;
      }
      return true;
    }

    // Single core token with minor typo (e.g. balamurgan vs balamurugan)
    if (coreA.length === 1 && coreB.length === 1) {
      const ca = coreA[0], cb = coreB[0];
      const dist = editDistance(ca, cb);
      if (dist <= 1 && Math.min(ca.length, cb.length) >= 6) {
        const initA = tokensA.filter(t => t.length === 1);
        const initB = tokensB.filter(t => t.length === 1);
        if (initA.length > 0 && initB.length > 0 && initA.join("") !== initB.join("")) {
          return false;
        }
        return true;
      }
    }
  }

  return false;
};

// Normalizes year representations ("2", "II", "II Year" -> "II", "3", "III", "III Year" -> "III", "4", "IV", "IV Year" -> "IV")
const normalizeYear = (yr) => {
  if (!yr) return "";
  const s = String(yr).trim().toUpperCase();
  if (s === "4" || s === "IV" || s.startsWith("IV") || s.includes("FINAL")) return "IV";
  if (s === "3" || s === "III" || s.startsWith("III") || s.includes("THIRD")) return "III";
  if (s === "2" || s === "II" || s.startsWith("II") || s.includes("SECOND")) return "II";
  if (s === "1" || s === "I" || s.startsWith("I") || s.includes("FIRST")) return "I";
  return s;
};

// Strict year equality check to prevent "III".includes("II") substring false matches!
const isSameYear = (yrA, yrB) => {
  if (!yrA || !yrB) return false;
  return normalizeYear(yrA) === normalizeYear(yrB);
};

// Helper: Identifies Library subjects/slots consistently across type, code, shortName, or name
const isLibraryItem = (item) => {
  if (!item) return false;
  const t = (item.type || "").toLowerCase();
  if (t.includes("lib")) return true;
  const text = `${item.subjectCode || item.code || ""} ${item.shortName || ""} ${item.subjectName || item.name || ""}`.toLowerCase();
  return /\b(lib|library)\b/i.test(text);
};

// Helper: Identifies Seminar subjects/slots consistently across type, code, shortName, or name
const isSeminarItem = (item) => {
  if (!item) return false;
  const t = (item.type || "").toLowerCase();
  if (t.includes("sem")) return true;
  const text = `${item.subjectCode || item.code || ""} ${item.shortName || ""} ${item.subjectName || item.name || ""}`.toLowerCase();
  return /\b(sem|seminar)\b/i.test(text);
};

// Helper: How many periods on 'day' are already taken by block sessions (Lab, Project, Training)
const isBlockType = (type) => {
  const t = (type || "").toLowerCase();
  return t.includes("lab") || t.includes("project");
};

// Helper: Checks if subject is a physical laboratory (e.g. WD Lab, DS Lab, Computer/Hardware lab).
// Placement, Aptitude, Career Development Skills (CDS), and classroom Training without Lab are NOT physical labs.
const isPhysicalLab = (item) => {
  if (!item) return false;
  if (isLibraryItem(item) || isSeminarItem(item)) return false;
  const text = `${item.subjectCode || item.code || ""} ${item.subjectName || item.name || ""} ${item.shortName || ""} ${item.type || ""}`.toLowerCase();
  if (text.includes("cds") || text.includes("aptitude") || text.includes("career") || text.includes("placement") ||
      text.includes("soft skill") || text.includes("counsel") || text.includes("mentor")) {
    return false;
  }
  if (isBlockType(item.type)) return true;
  // Also recognize courses explicitly named "... LAB" / "... Laboratory" even if type was set to Theory/Training
  const nameAndCode = `${item.subjectName || item.name || ""} ${item.shortName || ""} ${item.subjectCode || item.code || ""}`.toLowerCase();
  return /\b(lab|laboratory)\b/i.test(nameAndCode);
};

// Helper: Identifies any Lab or Project allocation/slot that must stay in continuous multi-period blocks
const isLabLikeBlock = (item) => {
  if (!item) return false;
  return isBlockType(item.type) || isPhysicalLab(item);
};

// Helper: Checks if an item represents a training subject (trainer course or continuous multi-hour pattern)
const isTrainingSubject = (item) => {
  if (!item) return false;
  if (item.isTraining) return true;
  const t = (item.type || "").toLowerCase();
  if (t.includes("training") || t.includes("trainer")) return true;
  const pat = (item.slotPattern || "").trim().toLowerCase();
  if (pat && pat !== "regular") return true;
  return false;
};

// Helper: Identifies any session (Lab, Project, OR Training / Continuous Block) that must stay in continuous multi-period blocks
const isContinuousBlockSubject = (item) => {
  if (!item) return false;
  if (isLabLikeBlock(item)) return true;
  if (isTrainingSubject(item)) return true;
  if (item.parsedPattern?.blocks && item.parsedPattern.blocks.length > 0) return true;
  return false;
};

// Helper: Checks if subject is pure Core Theory (NO lab, project, seminar, library, mentoring, free, training)
const isPureTheorySubject = (item) => {
  if (!item) return false;
  if (isLibraryItem(item) || isSeminarItem(item) || isContinuousBlockSubject(item)) return false;
  const t = (item.type || "").toLowerCase();
  const c = (item.subjectCode || item.code || "").toLowerCase();
  const n = (item.subjectName || item.name || "").toLowerCase();
  const s = (item.shortName || "").toLowerCase();
  if (t.includes("free") || t.includes("mentor") || t.includes("activity") || c === "free" || c === "tut" || s === "tut") {
    return false;
  }
  if (n.includes("mentoring") || n.includes("tutor ward")) {
    return false;
  }
  return true;
};

// Helper: Safely resolve allocated weekly hours without accidentally converting explicit 0 into 4
const getAllocHours = (item) => {
  if (!item) return 0;
  if (item.hoursPerWeek !== undefined && item.hoursPerWeek !== null && item.hoursPerWeek !== "") {
    const parsed = Number(item.hoursPerWeek);
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }
  if (isLibraryItem(item) || isSeminarItem(item) || (item.type || "").toLowerCase().includes("mentor")) {
    return 1;
  }
  if (isLabLikeBlock(item)) return 3;
  return 4;
};

// Helper: Match allocation row accurately to a class (year, semester when available, and section)
const matchesClassAllocation = (allocItem, cls) => {
  if (!allocItem || !cls) return false;
  const yrMatch = isSameYear(allocItem.year, cls.year);
  const semMatch = !cls.semester || !allocItem.semester || Number(allocItem.semester) === Number(cls.semester);
  const secMatch = !allocItem.section || allocItem.section === "All" || allocItem.section === cls.section;
  return yrMatch && semMatch && secMatch;
};

// Universal helper to check if a schedule slot matches an allocation item accurately
const isSameSubjectSlot = (slot, allocItem) => {
  if (!slot || slot.type === "Free" || slot.subjectCode === "FREE") return false;
  if (!allocItem) return false;

  const allocCode = (allocItem.subjectCode || allocItem.code || "").trim().toUpperCase();
  const slotCode = (slot.subjectCode || "").trim().toUpperCase();

  // 1. If subject codes match exactly, check same Lab/Theory category or Special category
  if (allocCode && slotCode && allocCode === slotCode) {
    return true;
  }

  // 2. If matching by shortName / abbreviation:
  // MUST strictly match course type (Laboratory vs Theory)!
  const allocShort = (allocItem.shortName || "").trim().toUpperCase();
  const slotShort = (slot.shortName || "").trim().toUpperCase();
  if (allocShort && slotShort && allocShort === slotShort) {
    const isAllocLab = isLabLikeBlock(allocItem);
    const isSlotLab = isLabLikeBlock(slot);
    if (isAllocLab === isSlotLab) {
      return true;
    }
  }

  // 3. Match Library and Seminar consistently across code, shortName, type, and subjectName
  if (isLibraryItem(allocItem) && isLibraryItem(slot)) return true;
  if (isSeminarItem(allocItem) && isSeminarItem(slot)) return true;

  return false;
};

// Helper: Checks if subject is Maths or Tough (Forbidden in Period 7)
const isMathsOrToughSubject = (subj) => {
  if (!subj) return false;
  if (subj.difficulty === "Tough") return true;
  const str = `${subj.subjectName || subj.name || ""} ${subj.shortName || ""} ${subj.subjectCode || subj.code || ""}`.toLowerCase();
  return /math|algebra|calculus|discrete|probability|statistics|numerical|pbs|nm|dm|flat|toc|automata|compiler|pas|daa|p&s|ps|maths/i.test(str);
};

// Helper: Checks if faculty is a Senior Administrative Leader (HOD, Asst HOD, ASP / Associate Professor)
// USER RULE 5: HOD, ASST HOD, and ASP MUST NEVER have classes in Period 1 or Period 2!
// (Morning periods 1 & 2 are strictly reserved for administrative duties, meetings, attendance, etc.)
const isSeniorAdminFaculty = (facultyName, staffMap = {}, coordinators = null) => {
  if (!facultyName || facultyName === "-") return false;
  const clean = String(facultyName).trim().toLowerCase();

  // Check string keywords in facultyName
  if (clean.includes("hod") || clean.includes("head") || clean.includes("asp") || clean.includes("assoc")) {
    return true;
  }

  // Check Staff database record designation
  if (staffMap) {
    const matchedKey = Object.keys(staffMap).find(k => isSameFacultyName(k, clean));
    if (matchedKey && staffMap[matchedKey]) {
      const desig = (staffMap[matchedKey].designation || "").toLowerCase();
      if (desig.includes("head") || desig.includes("hod") || desig.includes("assoc") || desig.includes("asp")) {
        return true;
      }
    }
  }

  if (coordinators && coordinators.hod) {
    const hodStr = String(coordinators.hod || "").toLowerCase();
    if (hodStr && isSameFacultyName(clean, hodStr)) return true;
  }

  return false;
};

// Extract normalized non-empty faculty list from an allocation or schedule slot
const getSlotFacultyList = (slotOrAlloc) => {
  if (!slotOrAlloc) return [];
  const raw = Array.isArray(slotOrAlloc.facultyNames) && slotOrAlloc.facultyNames.length > 0
    ? slotOrAlloc.facultyNames
    : (slotOrAlloc.facultyName ? String(slotOrAlloc.facultyName).split(",") : []);
  return raw.map(f => String(f || "").trim()).filter(f => f && f !== "-");
};

const isFreeSlot = (slot) => {
  if (!slot) return true;
  const sc = (slot.subjectCode || "").toUpperCase();
  const sn = (slot.shortName || "").toUpperCase();
  return slot.type === "Free" || sc === "FREE" || sn === "FREE" || sc === "TUT" || sn === "TUT" || sc === "MENTOR" || sn === "MENTOR";
};

const buildOccupiedSlotObject = (item, p, time) => {
  const facs = getSlotFacultyList(item);
  const isPhysical = isPhysicalLab(item);
  const isLib = isLibraryItem(item);
  const isSem = isSeminarItem(item);
  const isTr = !isPhysical && (!!item.isTraining || isTrainingSubject(item));
  return {
    period: p,
    time: time || DEFAULT_TIMINGS[p],
    subjectCode: item.subjectCode || item.code,
    subjectName: item.subjectName || item.name,
    shortName: item.shortName || item.subjectCode || item.code,
    facultyName: facs.join(", ") || "-",
    facultyNames: facs,
    type: item.type || (isPhysical ? "Lab" : (isTr ? "Training" : "Theory")),
    difficulty: item.difficulty || "Normal",
    isTraining: isTr,
    room: item.room || (isLib ? "Library" : (isSem ? "Seminar Hall" : (isPhysical ? (item.shortName || item.type || "LAB") : (isTr ? "Training Hall / LH-1" : "LH-1"))))
  };
};

// Standardized Free Period slot object
const makeFreeSlot = (period, time, room = "-") => ({
  period,
  time: time || DEFAULT_TIMINGS[period],
  subjectCode: "FREE",
  subjectName: "Free Period",
  shortName: "Free",
  facultyName: "-",
  facultyNames: [],
  type: "Free",
  difficulty: "Normal",
  room
});

// CASCADE helper: automatically updates allocations, schedule slots, and faculty routines everywhere
async function cascadeFacultyNameChange(oldName, newName, department = "CSE") {
  if (!oldName || !newName) {
    return { allocations: null, classes: null, facultySchedules: null };
  }

  const deptUpper = (department || "CSE").toUpperCase();

  // 1. Delete any other duplicate staff records in Staff collection matching oldName
  try {
    const allStaff = await Staff.find({ department: deptUpper });
    for (const s of allStaff) {
      if (s.name !== newName && isSameFacultyName(s.name, oldName)) {
        await Staff.findByIdAndDelete(s._id);
      }
    }
  } catch (err) {
    console.error("Error cleaning duplicate staff:", err);
  }

  // 2. Cascade in all TimetableAllocation docs
  let updatedAllocations = null;
  const allAllocDocs = await TimetableAllocation.find({});
  for (const aDoc of allAllocDocs) {
    let modified = false;
    (aDoc.allocations || []).forEach(item => {
      if (item.facultyName && isSameFacultyName(item.facultyName, oldName)) {
        item.facultyName = newName;
        modified = true;
      }
      if (Array.isArray(item.facultyNames) && item.facultyNames.length > 0) {
        const mapped = item.facultyNames.map(f => isSameFacultyName(f, oldName) ? newName : f);
        if (mapped.some((f, idx) => f !== item.facultyNames[idx])) {
          item.facultyNames = mapped;
          item.facultyName = mapped.join(", ");
          modified = true;
        }
      }
    });
    if (aDoc.classAdvisors) {
      Object.keys(aDoc.classAdvisors).forEach(ck => {
        if (aDoc.classAdvisors[ck] && isSameFacultyName(aDoc.classAdvisors[ck], oldName)) {
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
    updatedAllocations = aDoc.allocations;
  }

  // 3. Cascade in all TimetableSchedule docs and rebuild faculty routines
  let updatedClasses = null;
  let updatedFacultySchedules = null;
  const allSchedDocs = await TimetableSchedule.find({});
  const allStaffMembers = await Staff.find({ department: deptUpper });

  for (const sDoc of allSchedDocs) {
    let modified = false;
    (sDoc.classes || []).forEach(cls => {
      DAYS.forEach(d => {
        (cls.days[d] || []).forEach(slot => {
          if (!slot || slot.type === "Free" || slot.subjectCode === "FREE") return;

          if (slot.facultyName && isSameFacultyName(slot.facultyName, oldName)) {
            slot.facultyName = newName;
            modified = true;
          }
          if (Array.isArray(slot.facultyNames) && slot.facultyNames.length > 0) {
            const mapped = slot.facultyNames.map(f => isSameFacultyName(f, oldName) ? newName : f);
            if (mapped.some((f, idx) => f !== slot.facultyNames[idx])) {
              slot.facultyNames = mapped;
              slot.facultyName = mapped.join(", ");
              modified = true;
            }
          }
        });
      });
    });

    // Rebuild facultySchedules routines for all staff
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
          time: (sDoc.periodTimings && sDoc.periodTimings[p]) || DEFAULT_TIMINGS[p] || "09:10-10:05",
          occupied: false,
          classKey: "",
          subjectName: "",
          type: "Free"
        }));
      });
    });

    (sDoc.classes || []).forEach(cItem => {
      DAYS.forEach(d => {
        (cItem.days[d] || []).forEach(slot => {
          if (slot.type === "Free" || slot.subjectCode === "FREE") return;
          const facList = slot.facultyNames && slot.facultyNames.length > 0 ? slot.facultyNames : (slot.facultyName ? [slot.facultyName] : []);
          facList.forEach(fac => {
            const cleanFac = String(fac || "").trim();
            let targetKey = cleanFac;
            if (!facultySchedules[targetKey]) {
              const matchedKey = Object.keys(facultySchedules).find(k => isSameFacultyName(k, cleanFac));
              if (matchedKey) targetKey = matchedKey;
            }
            if (facultySchedules[targetKey]) {
              const periodIdx = slot.period - 1;
              if (facultySchedules[targetKey].days[d] && facultySchedules[targetKey].days[d][periodIdx]) {
                facultySchedules[targetKey].days[d][periodIdx] = {
                  period: slot.period,
                  time: slot.time || DEFAULT_TIMINGS[slot.period],
                  occupied: true,
                  classKey: cItem.classKey,
                  subjectCode: slot.subjectCode,
                  subjectName: slot.subjectName,
                  shortName: slot.shortName,
                  type: slot.type || "Theory"
                };
                facultySchedules[targetKey].totalHours += 1;
                if (slot.type === "Laboratory") facultySchedules[targetKey].labCount += 1;
                else facultySchedules[targetKey].theoryCount += 1;
              }
            }
          });
        });
      });
    });

    sDoc.facultySchedules = Object.values(facultySchedules);
    sDoc.markModified("classes");
    sDoc.markModified("facultySchedules");
    await sDoc.save();
    updatedClasses = sDoc.classes;
    updatedFacultySchedules = sDoc.facultySchedules;
  }

  return { allocations: updatedAllocations, classes: updatedClasses, facultySchedules: updatedFacultySchedules };
}

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

// CREATE a staff member (with duplicate detection & merge)
router.post("/staff", async (req, res) => {
  try {
    const { name, staffCode, email, department, designation, maxHoursPerWeek, maxTheory, maxLab, phone } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Staff name is required" });
    }
    const cleanName = name.trim();
    const deptUpper = (department || "CSE").toUpperCase();

    // Check if an existing staff matches fuzzy name
    const allStaff = await Staff.find({ department: deptUpper });
    const existing = allStaff.find(s => isSameFacultyName(s.name, cleanName));

    if (existing) {
      // Merge & Update instead of creating duplicate!
      const oldName = existing.name;
      existing.name = cleanName;
      if (staffCode) existing.staffCode = staffCode;
      if (email) existing.email = email;
      if (designation) existing.designation = designation;
      if (maxHoursPerWeek) existing.maxHoursPerWeek = Number(maxHoursPerWeek);
      if (maxTheory) existing.maxTheory = Number(maxTheory);
      if (maxLab) existing.maxLab = Number(maxLab);
      if (phone) existing.phone = phone;
      await existing.save();

      const cascaded = await cascadeFacultyNameChange(oldName, cleanName, deptUpper);
      return res.json({
        ...existing.toObject(),
        ...cascaded,
        message: `Updated existing faculty member and cascaded across timetable!`
      });
    }

    const staff = new Staff({
      name: cleanName,
      staffCode: staffCode || "",
      email: email || "",
      department: deptUpper,
      designation: designation || "Assistant Professor",
      maxHoursPerWeek: Number(maxHoursPerWeek) || 18,
      maxTheory: Number(maxTheory) || 2,
      maxLab: Number(maxLab) || 2,
      phone: phone || ""
    });
    await staff.save();

    // Cascade rename in case allocations/schedule already had this name
    const cascaded = await cascadeFacultyNameChange(cleanName, cleanName, deptUpper);
    res.json({
      ...staff.toObject(),
      ...cascaded
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// UPDATE a staff member (AUTOMATIC CASCADE EVERYWHERE: allocations, schedule slots, routines)
router.put("/staff/:id", async (req, res) => {
  try {
    const { name, staffCode, email, department, designation, maxHoursPerWeek, maxTheory, maxLab, phone } = req.body;
    const oldStaff = await Staff.findById(req.params.id);
    if (!oldStaff) return res.status(404).json({ error: "Staff not found" });

    const oldName = oldStaff.name ? oldStaff.name.trim() : "";
    const newName = name ? name.trim() : oldName;
    const deptUpper = (department || oldStaff.department || "CSE").toUpperCase();

    const updateData = {};
    if (name) updateData.name = newName;
    if (staffCode !== undefined) updateData.staffCode = staffCode;
    if (email !== undefined) updateData.email = email;
    if (department) updateData.department = deptUpper;
    if (designation) updateData.designation = designation;
    if (maxHoursPerWeek !== undefined) updateData.maxHoursPerWeek = Number(maxHoursPerWeek);
    if (maxTheory !== undefined) updateData.maxTheory = Number(maxTheory);
    if (maxLab !== undefined) updateData.maxLab = Number(maxLab);
    if (phone !== undefined) updateData.phone = phone;

    const staff = await Staff.findByIdAndUpdate(req.params.id, updateData, { new: true });

    // AUTOMATIC CASCADE EVERYWHERE IN SYSTEM!
    const cascaded = await cascadeFacultyNameChange(oldName, newName, deptUpper);

    res.json({
      ...staff.toObject(),
      ...cascaded,
      message: `Faculty updated everywhere across Timetable & Workload!`
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// REPLACE FACULTY NAME GLOBALLY (across Staff, Allocations, Schedule, and Faculty Routines)
router.post("/staff/replace-name", async (req, res) => {
  try {
    const { fromName, toName, department = "CSE" } = req.body;
    if (!fromName || !toName) {
      return res.status(400).json({ error: "fromName and toName are required" });
    }
    const cleanFrom = fromName.trim();
    const cleanTo = toName.trim();
    const fromLower = cleanFrom.toLowerCase();

    // 1. Update in Staff collection (case-insensitive match)
    await Staff.updateMany(
      { name: { $regex: new RegExp(`^${cleanFrom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") } },
      { $set: { name: cleanTo } }
    );

    // 2. Update in all TimetableAllocation docs
    const allocDocs = await TimetableAllocation.find({});
    let lastAllocDoc = null;
    for (const doc of allocDocs) {
      let modified = false;
      (doc.allocations || []).forEach(a => {
        if (a.facultyName && a.facultyName.trim().toLowerCase() === fromLower) {
          a.facultyName = cleanTo;
          modified = true;
        }
        if (Array.isArray(a.facultyNames)) {
          const newNames = a.facultyNames.map(f => (f && f.trim().toLowerCase() === fromLower) ? cleanTo : f);
          if (newNames.some((f, idx) => f !== a.facultyNames[idx])) {
            a.facultyNames = newNames;
            a.facultyName = newNames.join(", ");
            modified = true;
          }
        }
      });
      if (doc.classAdvisors) {
        Object.keys(doc.classAdvisors).forEach(ck => {
          if (doc.classAdvisors[ck] && doc.classAdvisors[ck].trim().toLowerCase() === fromLower) {
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
      lastAllocDoc = doc;
    }

    // 3. Update in all TimetableSchedule docs and rebuild faculty routines
    const schedDocs = await TimetableSchedule.find({});
    let lastSchedDoc = null;
    const allStaffMembers = await Staff.find({ department: department || "CSE" });

    for (const sDoc of schedDocs) {
      let modified = false;
      (sDoc.classes || []).forEach(cls => {
        DAYS.forEach(d => {
          (cls.days[d] || []).forEach(slot => {
            if (slot.facultyName && slot.facultyName.trim().toLowerCase() === fromLower) {
              slot.facultyName = cleanTo;
              modified = true;
            }
            if (Array.isArray(slot.facultyNames)) {
              const newNames = slot.facultyNames.map(f => (f && f.trim().toLowerCase() === fromLower) ? cleanTo : f);
              if (newNames.some((f, idx) => f !== slot.facultyNames[idx])) {
                slot.facultyNames = newNames;
                slot.facultyName = newNames.join(", ");
                modified = true;
              }
            }
          });
        });
      });

      // Recalculate facultySchedules for all staff
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
            time: (sDoc.periodTimings && sDoc.periodTimings[p]) || DEFAULT_TIMINGS[p] || "09:10-10:05",
            occupied: false,
            classKey: "",
            subjectName: "",
            type: "Free"
          }));
        });
      });

      (sDoc.classes || []).forEach(cItem => {
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
                    time: slot.time || DEFAULT_TIMINGS[slot.period],
                    occupied: true,
                    classKey: cItem.classKey,
                    subjectCode: slot.subjectCode,
                    subjectName: slot.subjectName,
                    shortName: slot.shortName,
                    type: slot.type || "Theory"
                  };
                  facultySchedules[cleanFac].totalHours += 1;
                  if (slot.type === "Laboratory") facultySchedules[cleanFac].labCount += 1;
                  else facultySchedules[cleanFac].theoryCount += 1;
                }
              }
            });
          });
        });
      });

      sDoc.facultySchedules = Object.values(facultySchedules);
      sDoc.markModified("classes");
      sDoc.markModified("facultySchedules");
      await sDoc.save();
      modified = true;
      lastSchedDoc = sDoc;
    }

    res.json({
      success: true,
      message: `Replaced faculty name '${cleanFrom}' with '${cleanTo}' across all staff, allocations, and schedule slots!`,
      classes: lastSchedDoc ? lastSchedDoc.classes : null,
      facultySchedules: lastSchedDoc ? lastSchedDoc.facultySchedules : null,
      allocations: lastAllocDoc ? lastAllocDoc.allocations : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CASCADE UNASSIGN helper: removes a faculty name from allocations, schedule slots, and rebuilds routines
async function unassignFacultyEverywhere(facultyName, department = "CSE") {
  if (!facultyName) return { allocations: null, classes: null, facultySchedules: null };
  const deptUpper = (department || "CSE").toUpperCase();

  // 1. Delete from Staff collection (any records matching this name)
  try {
    const allStaff = await Staff.find({ department: deptUpper });
    for (const s of allStaff) {
      if (isSameFacultyName(s.name, facultyName)) {
        await Staff.findByIdAndDelete(s._id);
      }
    }
  } catch (err) {
    console.error("Error deleting staff records:", err);
  }

  // 2. Unassign in all TimetableAllocation docs
  let updatedAllocations = null;
  const allAllocDocs = await TimetableAllocation.find({});
  for (const aDoc of allAllocDocs) {
    let modified = false;
    (aDoc.allocations || []).forEach(item => {
      if (item.facultyName && isSameFacultyName(item.facultyName, facultyName)) {
        item.facultyName = "";
        modified = true;
      }
      if (Array.isArray(item.facultyNames) && item.facultyNames.length > 0) {
        const filtered = item.facultyNames.filter(f => !isSameFacultyName(f, facultyName));
        if (filtered.length !== item.facultyNames.length) {
          item.facultyNames = filtered;
          item.facultyName = filtered.join(", ");
          modified = true;
        }
      }
    });
    if (aDoc.classAdvisors) {
      Object.keys(aDoc.classAdvisors).forEach(ck => {
        if (aDoc.classAdvisors[ck] && isSameFacultyName(aDoc.classAdvisors[ck], facultyName)) {
          aDoc.classAdvisors[ck] = "";
          modified = true;
        }
      });
    }
    if (modified) {
      aDoc.markModified("allocations");
      aDoc.markModified("classAdvisors");
      await aDoc.save();
    }
    updatedAllocations = aDoc.allocations;
  }

  // 3. Unassign in all TimetableSchedule docs and rebuild routines
  let updatedClasses = null;
  let updatedFacultySchedules = null;
  const allSchedDocs = await TimetableSchedule.find({});
  const remainingStaff = await Staff.find({ department: deptUpper });

  for (const sDoc of allSchedDocs) {
    let modified = false;
    (sDoc.classes || []).forEach(cls => {
      DAYS.forEach(d => {
        (cls.days[d] || []).forEach(slot => {
          if (!slot || slot.type === "Free" || slot.subjectCode === "FREE") return;

          if (slot.facultyName && isSameFacultyName(slot.facultyName, facultyName)) {
            slot.facultyName = "";
            modified = true;
          }
          if (Array.isArray(slot.facultyNames) && slot.facultyNames.length > 0) {
            const filtered = slot.facultyNames.filter(f => !isSameFacultyName(f, facultyName));
            if (filtered.length !== slot.facultyNames.length) {
              slot.facultyNames = filtered;
              slot.facultyName = filtered.join(", ");
              modified = true;
            }
          }
        });
      });
    });

    // Rebuild faculty routines for remaining staff
    const facultySchedules = {};
    remainingStaff.forEach(s => {
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
          time: (sDoc.periodTimings && sDoc.periodTimings[p]) || DEFAULT_TIMINGS[p] || "09:10-10:05",
          occupied: false,
          classKey: "",
          subjectName: "",
          type: "Free"
        }));
      });
    });

    (sDoc.classes || []).forEach(cItem => {
      DAYS.forEach(d => {
        (cItem.days[d] || []).forEach(slot => {
          if (slot.type === "Free" || slot.subjectCode === "FREE") return;
          const facList = slot.facultyNames && slot.facultyNames.length > 0 ? slot.facultyNames : (slot.facultyName ? [slot.facultyName] : []);
          facList.forEach(fac => {
            const cleanFac = String(fac || "").trim();
            let targetKey = cleanFac;
            if (!facultySchedules[targetKey]) {
              const matchedKey = Object.keys(facultySchedules).find(k => isSameFacultyName(k, cleanFac));
              if (matchedKey) targetKey = matchedKey;
            }
            if (facultySchedules[targetKey]) {
              const periodIdx = slot.period - 1;
              if (facultySchedules[targetKey].days[d] && facultySchedules[targetKey].days[d][periodIdx]) {
                facultySchedules[targetKey].days[d][periodIdx] = {
                  period: slot.period,
                  time: slot.time || DEFAULT_TIMINGS[slot.period],
                  occupied: true,
                  classKey: cItem.classKey,
                  subjectCode: slot.subjectCode,
                  subjectName: slot.subjectName,
                  shortName: slot.shortName,
                  type: slot.type || "Theory"
                };
                facultySchedules[targetKey].totalHours += 1;
                if (slot.type === "Laboratory") facultySchedules[targetKey].labCount += 1;
                else facultySchedules[targetKey].theoryCount += 1;
              }
            }
          });
        });
      });
    });

    sDoc.facultySchedules = Object.values(facultySchedules);
    if (modified) sDoc.markModified("classes");
    sDoc.markModified("facultySchedules");
    await sDoc.save();
    updatedClasses = sDoc.classes;
    updatedFacultySchedules = facultySchedules;
  }
 return { allocations: updatedAllocations, classes: updatedClasses, facultySchedules: updatedFacultySchedules };
}
// DELETE a staff member (with full cascade delete across allocations & schedule)
router.delete("/staff/:id", async (req, res) => {
  try {
    const staffDoc = await Staff.findById(req.params.id);
    const staffName = staffDoc ? staffDoc.name : "";
    const department = (staffDoc && staffDoc.department) || "CSE";

    if (req.params.id) {
      await Staff.findByIdAndDelete(req.params.id);
    }

    const cascadeRes = await unassignFacultyEverywhere(staffName, department);

    res.json({
      success: true,
      message: `Staff ${staffName || ""} deleted and unassigned everywhere!`,
      ...cascadeRes
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UNASSIGN / REMOVE faculty by name (works for registered staff or ghost names from allocations)
router.post("/staff/unassign-name", async (req, res) => {
  try {
    const { name, department = "CSE" } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Faculty name is required" });
    }
    const cascadeRes = await unassignFacultyEverywhere(name.trim(), department);
    res.json({
      success: true,
      message: `Faculty ${name} removed and unassigned everywhere!`,
      ...cascadeRes
    });
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

// Progressive constraint tiers for Step C & Auto-Heal deficit resolution:
// Strict rest breaks and period rules run first; constraints relax step-by-step ONLY when needed
// to eliminate unwanted FREE periods while keeping ZERO faculty clashes & exact hoursPerWeek caps.
const STEP_C_TIERS = [
  {
    name: "strict",
    respectFacWeeklyCap: true,
    allowAdjacentFac: false,
    maxDailyFacTheory: 3,
    maxDailyFacWithLab: 4,
    enforceP1CoreTheory: true,
    enforceSeniorAdminP1: true,
    enforceSeniorAdminP2: true,
    enforceP7NotTough: true,
    allowAdjacentSameSubj: false,
    maxSameSubjPerDay: 2,
    allowLibSemP1: false
  },
  {
    name: "relaxFatigue",
    respectFacWeeklyCap: true,
    allowAdjacentFac: true,
    maxDailyFacTheory: 5,
    maxDailyFacWithLab: 6,
    enforceP1CoreTheory: true,
    enforceSeniorAdminP1: true,
    enforceSeniorAdminP2: true,
    enforceP7NotTough: true,
    allowAdjacentSameSubj: false,
    maxSameSubjPerDay: 2,
    allowLibSemP1: false
  },
  {
    name: "relaxDailyCap",
    respectFacWeeklyCap: false,
    allowAdjacentFac: true,
    maxDailyFacTheory: 7,
    maxDailyFacWithLab: 7,
    enforceP1CoreTheory: true,
    enforceSeniorAdminP1: true,
    enforceSeniorAdminP2: true,
    enforceP7NotTough: true,
    allowAdjacentSameSubj: false,
    maxSameSubjPerDay: 2,
    allowLibSemP1: false
  },
  {
    name: "relaxSoftPeriods",
    respectFacWeeklyCap: false,
    allowAdjacentFac: true,
    maxDailyFacTheory: 7,
    maxDailyFacWithLab: 7,
    enforceP1CoreTheory: false,
    enforceSeniorAdminP1: true,
    enforceSeniorAdminP2: false,
    enforceP7NotTough: false,
    allowAdjacentSameSubj: false,
    maxSameSubjPerDay: 2,
    allowLibSemP1: false
  },
  {
    name: "emergencyZeroFree",
    respectFacWeeklyCap: false,
    allowAdjacentFac: true,
    maxDailyFacTheory: 7,
    maxDailyFacWithLab: 7,
    enforceP1CoreTheory: false,
    enforceSeniorAdminP1: false,
    enforceSeniorAdminP2: false,
    enforceP7NotTough: false,
    allowAdjacentSameSubj: true,
    maxSameSubjPerDay: 3,
    allowLibSemP1: true
  }
];

const getCandidateBlocksForDuration = (dur, isLab = false, includeExtendedRescue = false) => {
  if (dur >= 4) {
    return [{ name: "Morning (1-4)", periods: [1, 2, 3, 4] }];
  }
  if (dur === 3) {
    const base = [
      { name: "Afternoon (5-7)", periods: [5, 6, 7] },
      { name: "Morning (2-4)", periods: [2, 3, 4] }
    ];
    if (includeExtendedRescue) base.push({ name: "Morning (1-3)", periods: [1, 2, 3] });
    return base;
  }
  if (dur === 2) {
    // Official 2-hour blocks:
    // P1-P2 (09:10 - 11:00) Morning Session 1 (before tea break)
    // P3-P4 (11:15 - 01:00) Morning Session 2 (between tea break and lunch)
    // P5-P6 (01:45 - 03:35) Afternoon Session 1 (after lunch)
    const base = isLab
      ? [
          { name: "Afternoon (5-6)", periods: [5, 6] },
          { name: "Morning (3-4)", periods: [3, 4] },
          { name: "Morning (1-2)", periods: [1, 2] }
        ]
      : [
          { name: "Morning (1-2)", periods: [1, 2] },
          { name: "Morning (3-4)", periods: [3, 4] },
          { name: "Afternoon (5-6)", periods: [5, 6] }
        ];
    if (includeExtendedRescue) {
      base.push({ name: "Afternoon (6-7)", periods: [6, 7] });
    }
    return base;
  }
  return [
    { name: "Period 6", periods: [6] },
    { name: "Period 5", periods: [5] },
    { name: "Period 7", periods: [7] }
  ];
};

const parseSlotPattern = (pat, hours, isTr, type, isLab = false) => {
  const total = (hours !== undefined && hours !== null && hours !== "") ? Number(hours) : (isLab ? 3 : 4);
  if (isNaN(total) || total <= 0) return { blocks: [], singles: 0 };
  const cleanPat = (pat || "").trim().toLowerCase();

  if (cleanPat === "4" || cleanPat === "4h" || cleanPat === "half-day") {
    return isLab
      ? { blocks: [2, 2], singles: Math.max(0, total - 4) }
      : { blocks: [4], singles: Math.max(0, total - 4) };
  }
  if (cleanPat === "3" || cleanPat === "3h") {
    return { blocks: [3], singles: Math.max(0, total - 3) };
  }
  if (cleanPat === "2" || cleanPat === "2h") {
    return { blocks: [2], singles: Math.max(0, total - 2) };
  }
  if (cleanPat === "2+2") return { blocks: [2, 2], singles: Math.max(0, total - 4) };
  if (cleanPat === "2+2+2+2") return { blocks: [2, 2, 2, 2], singles: Math.max(0, total - 8) };
  if (cleanPat === "2+2+2") return { blocks: [2, 2, 2], singles: Math.max(0, total - 6) };
  if (cleanPat === "2+1") return { blocks: [2], singles: Math.max(0, total - 2) };
  if (cleanPat === "2+1+1") return { blocks: [2], singles: Math.max(0, total - 2) };
  if (cleanPat === "3+1") return { blocks: [3], singles: Math.max(0, total - 3) };
  if (cleanPat === "4+3") return { blocks: [4, 3], singles: Math.max(0, total - 7) };
  if (cleanPat === "2+2+1") return { blocks: [2, 2], singles: Math.max(0, total - 4) };
  if (cleanPat === "3+2") return { blocks: [3, 2], singles: Math.max(0, total - 5) };

  if (cleanPat && cleanPat !== "regular" && cleanPat !== "block") {
    const parts = cleanPat.split(/[\+,\s\-\/]+/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0);
    if (parts.length > 0) {
      const blocks = [];
      let singles = 0;
      let patternSum = 0;
      parts.forEach(p => {
        patternSum += p;
        if (p >= 2) blocks.push(p);
        else singles += p;
      });
      if (total > patternSum) singles += (total - patternSum);
      return { blocks, singles };
    }
  }

  if (isLab || isBlockType(type)) {
    if (total >= 4) {
      const twoBlocks = [];
      let rem = total;
      while (rem >= 4 || rem === 2) {
        twoBlocks.push(2);
        rem -= 2;
      }
      if (rem === 3) { twoBlocks.push(3); rem = 0; }
      return { blocks: twoBlocks, singles: rem };
    }
    if (total === 3) return { blocks: [3], singles: 0 };
    if (total === 2) return { blocks: [2], singles: 0 };
    return { blocks: [], singles: total };
  }

  if (cleanPat === "regular" || (!cleanPat && !isTr && !(type && type.toLowerCase().includes("training")))) {
    return { blocks: [], singles: total };
  }

  // Training fallback when cleanPat is not explicitly specified:
  if (total >= 8) {
    const numTwos = Math.floor(total / 2);
    const rem = total % 2;
    return { blocks: Array(numTwos).fill(2), singles: rem };
  }
  if (total >= 7) return { blocks: [4, 3], singles: Math.max(0, total - 7) };
  if (total === 6) return { blocks: [2, 2, 2], singles: 0 };
  if (total === 5) return { blocks: [2, 2], singles: 1 };
  if (total === 4) return { blocks: [2, 2], singles: 0 };
  if (total === 3) return { blocks: [2], singles: 1 };
  if (total === 2) return { blocks: [2], singles: 0 };
  return { blocks: [], singles: total };
};

// Shared Grid Constraint Engine & Multi-Tiered Repair Solver (used by POST /generate and healScheduleFreeSlots)
const createGridSolver = ({ classGrid, classKeys, classGroups, facultyMaxWorkloadMap = {}, staffMap = {}, coordinators = null, timings = DEFAULT_TIMINGS }) => {
  const facultyBusy = {};

  const resolveFacKey = (facultyName) => {
    if (!facultyName || facultyName === "-") return "";
    if (facultyBusy[facultyName]) return facultyName;
    const matched = Object.keys(facultyBusy).find(k => isSameFacultyName(k, facultyName));
    return matched || String(facultyName).trim();
  };

  const markFacultyBusy = (facultyName, day, period, ck) => {
    const key = resolveFacKey(facultyName);
    if (!key) return;
    if (!facultyBusy[key]) facultyBusy[key] = {};
    if (!facultyBusy[key][day]) facultyBusy[key][day] = {};
    facultyBusy[key][day][period] = ck;
  };

  const unmarkFacultyBusy = (facultyName, day, period) => {
    const key = resolveFacKey(facultyName);
    if (!key) return;
    if (facultyBusy[key]?.[day]) {
      delete facultyBusy[key][day][period];
    }
  };

  const isFacultyFree = (facultyName, day, period) => {
    const key = resolveFacKey(facultyName);
    if (!key) return true;
    return !facultyBusy[key]?.[day]?.[period];
  };

  const markSlotBusy = (slot, ck, day, p) => {
    getSlotFacultyList(slot).forEach(f => markFacultyBusy(f, day, p, ck));
  };

  const unmarkSlotBusy = (slot, day, p) => {
    getSlotFacultyList(slot).forEach(f => unmarkFacultyBusy(f, day, p));
  };

  // Sync facultyBusy initially from classGrid
  classKeys.forEach(ck => {
    DAYS.forEach(day => {
      PERIODS.forEach(p => {
        const slot = classGrid[ck]?.[day]?.[p];
        if (slot && !isFreeSlot(slot)) {
          markSlotBusy(slot, ck, day, p);
        }
      });
    });
  });

  const areAllFacsFree = (facs, day, p) => facs.every(f => isFacultyFree(f, day, p));
  const checkSeniorAdmin = (facName) => isSeniorAdminFaculty(facName, staffMap, coordinators);
  const anySeniorAdmin = (facs) => facs.some(f => checkSeniorAdmin(f));

  const getFacultyDailyHours = (facName, day) => {
    const key = resolveFacKey(facName);
    if (!key || !facultyBusy[key]?.[day]) return 0;
    return Object.keys(facultyBusy[key][day]).length;
  };

  const doesFacultyHaveBlockOnDay = (facName, day) => {
    const key = resolveFacKey(facName);
    if (!key || !facultyBusy[key]?.[day]) return false;
    return PERIODS.some(p => {
      const ck = facultyBusy[key][day][p];
      if (!ck) return false;
      const slot = classGrid[ck]?.[day]?.[p];
      return slot && (isLabLikeBlock(slot) || slot.isTraining);
    });
  };

  const doesFacultyHaveLabOnDay = (facName, day) => {
    const key = resolveFacKey(facName);
    if (!key || !facultyBusy[key]?.[day]) return false;
    return PERIODS.some(p => {
      const ck = facultyBusy[key][day][p];
      if (!ck) return false;
      const slot = classGrid[ck]?.[day]?.[p];
      return slot && isPhysicalLab(slot);
    });
  };

  const getFacultyTotalScheduledHours = (facName) => {
    const key = resolveFacKey(facName);
    if (!key || !facultyBusy[key]) return 0;
    let count = 0;
    DAYS.forEach(d => {
      if (facultyBusy[key][d]) count += Object.keys(facultyBusy[key][d]).length;
    });
    return count;
  };

  const canFacultyTakeMoreHours = (facName) => {
    if (!facName || facName === "-") return true;
    const matchedKey = Object.keys(facultyMaxWorkloadMap).find(k => isSameFacultyName(k, facName));
    if (!matchedKey) return true;
    return getFacultyTotalScheduledHours(facName) < facultyMaxWorkloadMap[matchedKey];
  };

  const canAllFacsTakeMoreHours = (facs) => facs.every(f => canFacultyTakeMoreHours(f));

  const getPlacedCountInClass = (ck, allocItem) => {
    let count = 0;
    DAYS.forEach(d => {
      PERIODS.forEach(p => {
        const s = classGrid[ck]?.[d]?.[p];
        if (s && isSameSubjectSlot(s, allocItem)) count++;
      });
    });
    return count;
  };

  const canSubjectTakeMoreHoursInClass = (ck, allocItem) => {
    if (!allocItem) return false;
    const maxNeeded = getAllocHours(allocItem);
    if (maxNeeded <= 0) return false;
    return getPlacedCountInClass(ck, allocItem) < maxNeeded;
  };

  const getClassBlockCountOnDay = (ck, day) => {
    let count = 0;
    PERIODS.forEach(p => {
      const slot = classGrid[ck]?.[day]?.[p];
      if (slot && (isLabLikeBlock(slot) || slot.isTraining)) count++;
    });
    return count;
  };

  const hasLabOnDay = (ck, day) =>
    PERIODS.some(p => {
      const slot = classGrid[ck]?.[day]?.[p];
      return slot && isPhysicalLab(slot);
    });

  const hasAdjacentFacultyHour = (facName, day, p) => {
    if (!facName) return false;
    const left = p > 1 && !isFacultyFree(facName, day, p - 1);
    const right = p < 7 && !isFacultyFree(facName, day, p + 1);
    return left || right;
  };

  const getFacultyPeriodCount = (facName, p) => {
    const key = resolveFacKey(facName);
    if (!key || !facultyBusy[key]) return 0;
    let count = 0;
    DAYS.forEach(d => {
      if (facultyBusy[key][d]?.[p]) count++;
    });
    return count;
  };

  const getSubjectPeriodCount = (ck, subjectCode, p) => {
    let count = 0;
    DAYS.forEach(d => {
      const slot = classGrid[ck]?.[d]?.[p];
      if (slot && slot.subjectCode === subjectCode) count++;
    });
    return count;
  };

  const getSubjectMorningCount = (ck, subjectCode) => {
    let count = 0;
    DAYS.forEach(d => {
      [1, 2, 3, 4].forEach(p => {
        if (classGrid[ck]?.[d]?.[p]?.subjectCode === subjectCode) count++;
      });
    });
    return count;
  };

  const getSubjectAfternoonCount = (ck, subjectCode) => {
    let count = 0;
    DAYS.forEach(d => {
      [5, 6, 7].forEach(p => {
        if (classGrid[ck]?.[d]?.[p]?.subjectCode === subjectCode) count++;
      });
    });
    return count;
  };

  const causesFacultyContinuousFatigue = (facName, day, p) => {
    if (!facName || facName === "-") return false;
    if (p <= 2 && checkSeniorAdmin(facName)) return true;
    if (p > 1 && !isFacultyFree(facName, day, p - 1)) return true;
    if (p < 7 && !isFacultyFree(facName, day, p + 1)) return true;
    if (p === 4 && !isFacultyFree(facName, day, 5)) return true;
    if (p === 5 && !isFacultyFree(facName, day, 4)) return true;

    const dailyHours = getFacultyDailyHours(facName, day);
    const hasLabToday = doesFacultyHaveLabOnDay(facName, day) || doesFacultyHaveBlockOnDay(facName, day);
    const maxDailyCap = hasLabToday ? 4 : 3;
    return dailyHours >= maxDailyCap;
  };

  const wouldCauseFacultyBlockFatigue = (facName, day, blockPeriods, allowSeparatedSameDayBlock = false, isLabItem = false, { allowBlockGapRelaxed = false, allowSeniorAdminP2 = false, maxDailyOverride = null } = {}) => {
    if (!facName || facName === "-") return false;
    const key = resolveFacKey(facName);
    const minP = Math.min(...blockPeriods);
    const maxP = Math.max(...blockPeriods);

    if (checkSeniorAdmin(facName)) {
      if (minP === 1) return true;
      if (minP === 2 && !allowSeniorAdminP2) return true;
    }

    if (!allowBlockGapRelaxed) {
      if (minP > 1 && !isFacultyFree(facName, day, minP - 1)) return true;
      if (maxP < 7 && !isFacultyFree(facName, day, maxP + 1)) return true;
      if (minP === 5 && !isFacultyFree(facName, day, 4)) return true;
      if (maxP === 4 && !isFacultyFree(facName, day, 5)) return true;
    }

    if (!allowSeparatedSameDayBlock) {
      if (doesFacultyHaveBlockOnDay(facName, day)) return true;
      const daily = getFacultyDailyHours(facName, day);
      if (daily + blockPeriods.length > (maxDailyOverride || 4)) return true;
      return false;
    }

    if (!allowBlockGapRelaxed) {
      const occupiedPeriods = key && facultyBusy[key]?.[day]
        ? Object.keys(facultyBusy[key][day]).map(Number).filter(n => !isNaN(n))
        : [];
      if (occupiedPeriods.length > 0) {
        const separatedMorningToAfternoon = occupiedPeriods.every(bp => bp <= 3) && minP >= 5;
        const separatedLateAfternoon = occupiedPeriods.every(bp => bp <= 4) && minP >= 6;
        const separatedAfternoonToMorning = occupiedPeriods.every(bp => bp >= 5) && maxP <= 3;
        const separatedEarlyMorning = occupiedPeriods.every(bp => bp >= 6) && maxP <= 4;
        if (!separatedMorningToAfternoon && !separatedLateAfternoon && !separatedAfternoonToMorning && !separatedEarlyMorning) {
          return true;
        }
      }
    }

    const daily = getFacultyDailyHours(facName, day);
    const maxDailyInRelaxed = maxDailyOverride || (isLabItem ? 5 : 4);
    return daily + blockPeriods.length > maxDailyInRelaxed;
  };

  // Transaction helpers for atomic multi-move rescue / swaps (zero state corruption on rollback)
  const txPlace = (ck, day, p, slotObj, tx) => {
    classGrid[ck][day][p] = slotObj;
    markSlotBusy(slotObj, ck, day, p);
    tx.push({ kind: "place", ck, day, p, slot: slotObj });
  };

  const txRemove = (ck, day, p, tx) => {
    const slotObj = classGrid[ck][day][p];
    if (!slotObj) return null;
    unmarkSlotBusy(slotObj, day, p);
    classGrid[ck][day][p] = null;
    tx.push({ kind: "remove", ck, day, p, slot: slotObj });
    return slotObj;
  };

  const rollbackTx = (tx) => {
    for (let i = tx.length - 1; i >= 0; i--) {
      const entry = tx[i];
      if (entry.kind === "place") {
        unmarkSlotBusy(entry.slot, entry.day, entry.p);
        classGrid[entry.ck][entry.day][entry.p] = null;
      } else if (entry.kind === "remove") {
        classGrid[entry.ck][entry.day][entry.p] = entry.slot;
        markSlotBusy(entry.slot, entry.ck, entry.day, entry.p);
      }
    }
  };

  // Unified validator for placing a single 1-hour slot under a constraint tier
  const canPlaceSingleInClass = (ck, item, day, p, tier, { skipQuotaCheck = false } = {}) => {
    if (!item || classGrid[ck]?.[day]?.[p] !== null) return false;
    if (!skipQuotaCheck && !canSubjectTakeMoreHoursInClass(ck, item)) return false;

    const facs = getSlotFacultyList(item);
    if (!skipQuotaCheck && tier.respectFacWeeklyCap && !canAllFacsTakeMoreHours(facs)) return false;
    if (!areAllFacsFree(facs, day, p)) return false;

    const isLibOrSem = isLibraryItem(item) || isSeminarItem(item);
    if (p === 1) {
      if (isLibOrSem && !tier.allowLibSemP1) return false;
      if (tier.enforceP1CoreTheory && !isPureTheorySubject(item)) return false;
      if (tier.enforceSeniorAdminP1 && anySeniorAdmin(facs)) return false;
    }
    if (p === 2 && tier.enforceSeniorAdminP2 && anySeniorAdmin(facs)) return false;
    if (p === 7 && tier.enforceP7NotTough && isMathsOrToughSubject(item)) return false;

    for (const f of facs) {
      if (!tier.allowAdjacentFac) {
        if (p > 1 && !isFacultyFree(f, day, p - 1)) return false;
        if (p < 7 && !isFacultyFree(f, day, p + 1)) return false;
        if (p === 4 && !isFacultyFree(f, day, 5)) return false;
        if (p === 5 && !isFacultyFree(f, day, 4)) return false;
      }
      const dailyHours = getFacultyDailyHours(f, day);
      const cap = doesFacultyHaveBlockOnDay(f, day) ? tier.maxDailyFacWithLab : tier.maxDailyFacTheory;
      if (dailyHours >= cap) return false;
    }

    const left = p > 1 ? classGrid[ck][day][p - 1] : null;
    const right = p < 7 ? classGrid[ck][day][p + 1] : null;
    if (!tier.allowAdjacentSameSubj && ((left && isSameSubjectSlot(left, item)) || (right && isSameSubjectSlot(right, item)))) {
      return false;
    }

    const timesToday = PERIODS.filter(pr => pr !== p && classGrid[ck][day][pr] && isSameSubjectSlot(classGrid[ck][day][pr], item)).length;
    const maxToday = isLibOrSem ? 1 : (tier.maxSameSubjPerDay || 2);
    if (timesToday >= maxToday) return false;

    return true;
  };

  // Block placer supporting strict pass, lunch separation, single displacement, and deep cross-class rescue
  const placeBlockIntoClass = (ck, item, blockDur, {
    isLabPhase = false,
    relaxedPass = false,
    allowClassSecondLab = false,
    allowLabDisplacement = false
  }) => {
    const facs = getSlotFacultyList(item);
    const candidateBlocks = getCandidateBlocksForDuration(blockDur, isLabPhase, false);
    const isPhysical = isPhysicalLab(item);

    const sortDaysForBlock = () => [...DAYS].sort((d1, d2) => {
      const hasSubj1 = PERIODS.some(p => classGrid[ck][d1][p] && isSameSubjectSlot(classGrid[ck][d1][p], item)) ? 500 : 0;
      const hasSubj2 = PERIODS.some(p => classGrid[ck][d2][p] && isSameSubjectSlot(classGrid[ck][d2][p], item)) ? 500 : 0;
      if (hasSubj1 !== hasSubj2) return hasSubj1 - hasSubj2;

      if (isPhysical) {
        const hasLab1 = hasLabOnDay(ck, d1) ? 200 : 0;
        const hasLab2 = hasLabOnDay(ck, d2) ? 200 : 0;
        if (hasLab1 !== hasLab2) return hasLab1 - hasLab2;

        const facLab1 = facs.some(f => doesFacultyHaveLabOnDay(f, d1)) ? 150 : 0;
        const facLab2 = facs.some(f => doesFacultyHaveLabOnDay(f, d2)) ? 150 : 0;
        if (facLab1 !== facLab2) return facLab1 - facLab2;
      }

      if (facs.length > 0) {
        const facDaily1 = Math.max(...facs.map(f => getFacultyDailyHours(f, d1)));
        const facDaily2 = Math.max(...facs.map(f => getFacultyDailyHours(f, d2)));
        if (facDaily1 !== facDaily2) return facDaily1 - facDaily2;
      }

      const placedDays = item.placedBlockDays || [];
      const isAlt1 = placedDays.length === 0 || placedDays.some(pd => Math.abs(DAYS.indexOf(d1) - DAYS.indexOf(pd)) >= 2);
      const isAlt2 = placedDays.length === 0 || placedDays.some(pd => Math.abs(DAYS.indexOf(d2) - DAYS.indexOf(pd)) >= 2);
      if (isAlt1 !== isAlt2) return isAlt1 ? -1 : 1;

      const c1 = getClassBlockCountOnDay(ck, d1);
      const c2 = getClassBlockCountOnDay(ck, d2);
      if (c1 !== c2) return c1 - c2;
      return Math.random() - 0.5;
    });

    const scoreCandidateBlocks = (blocks, day) => blocks.map(block => {
      let score = 0;
      if (isMathsOrToughSubject(item)) {
        if (block.periods.includes(7)) score += 99999;
        if (block.periods.includes(6)) score += 8000;
      }
      // Only heavy physical machinery/hardware labs avoid P1 in strict passes;
      // Training and 2h continuous blocks run comfortably in P1-P2 (09:10-11:00)
      if (isPhysical && block.periods.includes(1) && !relaxedPass) {
        score += 99999;
      }
      facs.forEach(f => {
        block.periods.forEach(p => {
          const pCount = getFacultyPeriodCount(f, p);
          if (pCount >= 2) score += pCount * 4500;
          else if (pCount === 1) score += 1600;
          else score -= 900;
        });
      });
      const isMorning = block.periods.some(p => p <= 4);
      const classMorningBlocks = DAYS.filter(d => classGrid[ck][d] && (classGrid[ck][d][3]?.isTraining || classGrid[ck][d][4]?.isTraining || isPhysicalLab(classGrid[ck][d][3]) || isPhysicalLab(classGrid[ck][d][4]))).length;
      const classAfternoonBlocks = DAYS.filter(d => classGrid[ck][d] && (classGrid[ck][d][5]?.isTraining || classGrid[ck][d][6]?.isTraining || isPhysicalLab(classGrid[ck][d][5]) || isPhysicalLab(classGrid[ck][d][6]))).length;
      if (isMorning && classMorningBlocks > classAfternoonBlocks) score += 1500;
      else if (!isMorning && classAfternoonBlocks > classMorningBlocks) score += 1500;

      const sectionLetter = (classGroups[ck]?.section || "A").toUpperCase();
      if (sectionLetter === "B") score += isMorning ? 500 : -500;

      // Prefer zero adjacent faculty periods when possible
      const adjCount = facs.filter(f => {
        const minP = Math.min(...block.periods);
        const maxP = Math.max(...block.periods);
        return (minP > 1 && !isFacultyFree(f, day, minP - 1)) || (maxP < 7 && !isFacultyFree(f, day, maxP + 1));
      }).length;
      score += adjCount * 12000;

      return { block, score };
    }).sort((a, b) => a.score - b.score);

    const candidateDays = sortDaysForBlock();

    for (const day of candidateDays) {
      if (isPhysical && !allowClassSecondLab && hasLabOnDay(ck, day)) continue;
      if (isPhysical && !relaxedPass && facs.some(f => doesFacultyHaveLabOnDay(f, day))) continue;
      if (PERIODS.some(p => classGrid[ck][day][p] && isSameSubjectSlot(classGrid[ck][day][p], item))) continue;

      const scoredBlocks = scoreCandidateBlocks(candidateBlocks, day);

      for (const { block } of scoredBlocks) {
        const allClassFree = block.periods.every(p => classGrid[ck][day][p] === null);
        const allFacsReady = facs.every(f =>
          block.periods.every(p => isFacultyFree(f, day, p)) &&
          !wouldCauseFacultyBlockFatigue(f, day, block.periods, relaxedPass, isPhysical)
        );

        if (allClassFree && allFacsReady) {
          block.periods.forEach(p => {
            classGrid[ck][day][p] = buildOccupiedSlotObject(item, p, timings[p] || DEFAULT_TIMINGS[p]);
            markSlotBusy(classGrid[ck][day][p], ck, day, p);
          });
          item.placedBlocksHours = (item.placedBlocksHours || 0) + blockDur;
          item.placedBlockDays = [...(item.placedBlockDays || []), day];
          return true;
        }

        if (allowLabDisplacement && allFacsReady) {
          const occupiedInBlock = block.periods.filter(p => classGrid[ck][day][p] !== null);
          const allMovable = occupiedInBlock.every(p => {
            const bSlot = classGrid[ck][day][p];
            return bSlot && !bSlot.isPinned && !isLabLikeBlock(bSlot);
          });
          if (allMovable && occupiedInBlock.length > 0) {
            const tx = [];
            const removed = occupiedInBlock.map(p => txRemove(ck, day, p, tx));
            let allMoved = true;
            for (const remSlot of removed) {
              let destFound = false;
              for (const destDay of DAYS) {
                if (destFound) break;
                for (const destP of PERIODS) {
                  if (destDay === day && block.periods.includes(destP)) continue;
                  if (canPlaceSingleInClass(ck, remSlot, destDay, destP, STEP_C_TIERS[1], { skipQuotaCheck: true })) {
                    txPlace(ck, destDay, destP, { ...remSlot, period: destP, time: timings[destP] || DEFAULT_TIMINGS[destP] }, tx);
                    destFound = true;
                    break;
                  }
                }
              }
              if (!destFound) {
                allMoved = false;
                break;
              }
            }
            if (allMoved) {
              block.periods.forEach(p => {
                txPlace(ck, day, p, buildOccupiedSlotObject(item, p, timings[p] || DEFAULT_TIMINGS[p]), tx);
              });
              item.placedBlocksHours = (item.placedBlocksHours || 0) + blockDur;
              item.placedBlockDays = [...(item.placedBlockDays || []), day];
              return true;
            }
            rollbackTx(tx);
          }
        }
      }
    }
    return false;
  };

  // Liberate a blocking single slot inside another class via direct empty move or 1-for-1 intra-class swap
  const tryRelocateSingleSlotInOtherClass = (blockerCk, day, p, forbiddenFacs, moveTier, tx) => {
    const otherSlot = blockerCk ? classGrid[blockerCk]?.[day]?.[p] : null;
    if (!otherSlot || otherSlot.isPinned || isLabLikeBlock(otherSlot) || otherSlot.isTraining) {
      return false;
    }

    const localTx = [];
    txRemove(blockerCk, day, p, localTx);

    for (const altD of DAYS) {
      for (const altP of PERIODS) {
        if (canPlaceSingleInClass(blockerCk, otherSlot, altD, altP, moveTier, { skipQuotaCheck: true })) {
          txPlace(blockerCk, altD, altP, { ...otherSlot, period: altP, time: timings[altP] || DEFAULT_TIMINGS[altP] }, localTx);
          tx.push(...localTx);
          return true;
        }
      }
    }

    for (const d2 of DAYS) {
      for (const p2 of PERIODS) {
        if (d2 === day && p2 === p) continue;
        const s2 = classGrid[blockerCk][d2][p2];
        if (!s2 || s2.isPinned || isLabLikeBlock(s2) || s2.isTraining) continue;
        if (getSlotFacultyList(s2).some(sf => forbiddenFacs.some(ff => isSameFacultyName(sf, ff)))) continue;

        const subTx = [];
        txRemove(blockerCk, d2, p2, subTx);
        const s2Ok = canPlaceSingleInClass(blockerCk, s2, day, p, moveTier, { skipQuotaCheck: true });
        const otherOk = s2Ok && canPlaceSingleInClass(blockerCk, otherSlot, d2, p2, moveTier, { skipQuotaCheck: true });
        if (otherOk) {
          txPlace(blockerCk, day, p, { ...s2, period: p, time: timings[p] || DEFAULT_TIMINGS[p] }, subTx);
          txPlace(blockerCk, d2, p2, { ...otherSlot, period: p2, time: timings[p2] || DEFAULT_TIMINGS[p2] }, subTx);
          tx.push(...localTx, ...subTx);
          return true;
        }
        rollbackTx(subTx);
      }
    }

    rollbackTx(localTx);
    return false;
  };

  // Deep Cross-Class & Extended Block Rescue (runs ONLY if passes 1-3 could not place a block)
  const rescueBlockIntoClass = (ck, item, blockDur, isLabPhase = true) => {
    const facs = getSlotFacultyList(item);
    const isPhysical = isPhysicalLab(item);
    const rescueLevels = [
      { includeExtended: false, allowSeniorAdminP2: false, maxDaily: 6, tierIdx: 1, allowSameSubjDay: false },
      { includeExtended: true, allowSeniorAdminP2: false, maxDaily: 7, tierIdx: 2, allowSameSubjDay: false },
      { includeExtended: true, allowSeniorAdminP2: true, maxDaily: 7, tierIdx: 4, allowSameSubjDay: true }
    ];

    for (const lvl of rescueLevels) {
      const blocks = getCandidateBlocksForDuration(blockDur, isLabPhase, lvl.includeExtended);
      for (const day of DAYS) {
        if (!lvl.allowSameSubjDay && PERIODS.some(p => classGrid[ck][day][p] && isSameSubjectSlot(classGrid[ck][day][p], item))) {
          continue;
        }
        for (const block of blocks) {
          const minP = Math.min(...block.periods);
          if (minP === 1 && anySeniorAdmin(facs) && lvl.tierIdx < 4) continue;
          if (minP <= 2 && anySeniorAdmin(facs) && !lvl.allowSeniorAdminP2) continue;

          // Ensure no daily fatigue cap exceeded
          if (facs.some(f => wouldCauseFacultyBlockFatigue(f, day, block.periods, true, isPhysical, {
            allowBlockGapRelaxed: true,
            allowSeniorAdminP2: lvl.allowSeniorAdminP2,
            maxDailyOverride: lvl.maxDaily
          }))) {
            continue;
          }

          // All target periods in ck must not be pinned or another lab/training block
          const blockedByHard = block.periods.some(bp => {
            const sl = classGrid[ck][day][bp];
            return sl && (sl.isPinned || isContinuousBlockSubject(sl));
          });
          if (blockedByHard) continue;

          const tx = [];
          const heldBlockers = [];
          for (const bp of block.periods) {
            if (classGrid[ck][day][bp] !== null) {
              heldBlockers.push(txRemove(ck, day, bp, tx));
            }
          }

          // Cross-class faculty liberation: relocate blocking single non-pinned slots in other classes
          let facLibOk = true;
          const moveTier = STEP_C_TIERS[Math.min(lvl.tierIdx, 2)];
          for (const f of facs) {
            if (!facLibOk) break;
            for (const bp of block.periods) {
              if (isFacultyFree(f, day, bp)) continue;
              const fKey = resolveFacKey(f);
              const blockerCk = facultyBusy[fKey]?.[day]?.[bp];
              if (!blockerCk || blockerCk === ck || !tryRelocateSingleSlotInOtherClass(blockerCk, day, bp, facs, moveTier, tx)) {
                facLibOk = false;
                break;
              }
            }
          }

          if (!facLibOk || !block.periods.every(bp => areAllFacsFree(facs, day, bp))) {
            rollbackTx(tx);
            continue;
          }

          // Reserve the block first so heldBlockers cannot steal its faculty/slots
          block.periods.forEach(bp => {
            txPlace(ck, day, bp, buildOccupiedSlotObject(item, bp, timings[bp] || DEFAULT_TIMINGS[bp]), tx);
          });

          // Relocate displaced ck blockers into valid free slots in ck
          let blockersPlaced = true;
          for (const hb of heldBlockers) {
            let hbDone = false;
            for (const destTier of [STEP_C_TIERS[1], STEP_C_TIERS[Math.max(lvl.tierIdx, 2)], STEP_C_TIERS[4]]) {
              if (hbDone) break;
              for (const destD of DAYS) {
                if (hbDone) break;
                for (const destP of PERIODS) {
                  if (canPlaceSingleInClass(ck, hb, destD, destP, destTier, { skipQuotaCheck: true })) {
                    txPlace(ck, destD, destP, { ...hb, period: destP, time: timings[destP] || DEFAULT_TIMINGS[destP] }, tx);
                    hbDone = true;
                    break;
                  }
                }
              }
            }
            if (!hbDone) {
              blockersPlaced = false;
              break;
            }
          }

          if (blockersPlaced) {
            item.placedBlocksHours = (item.placedBlocksHours || 0) + blockDur;
            item.placedBlockDays = [...(item.placedBlockDays || []), day];
            return true;
          }
          rollbackTx(tx);
        }
      }
    }
    return false;
  };

  const getDeficitCandidates = (ck) => {
    const clsAllocs = classGroups[ck]?.allocations || [];
    return clsAllocs.filter(a => {
      const singlesAllowed = a.parsedPattern ? (a.parsedPattern.singles || 0) : 0;
      if (isContinuousBlockSubject(a) && singlesAllowed === 0) {
        return false; // Never split unplaced Labs or continuous Training blocks into single 1h periods
      }
      return canSubjectTakeMoreHoursInClass(ck, a);
    }).sort((a, b) => {
      const defA = Math.max(0, getAllocHours(a) - getPlacedCountInClass(ck, a));
      const defB = Math.max(0, getAllocHours(b) - getPlacedCountInClass(ck, b));
      if (defA !== defB) return defB - defA;
      const isSpecialA = (isLibraryItem(a) || isSeminarItem(a)) ? 1 : 0;
      const isSpecialB = (isLibraryItem(b) || isSeminarItem(b)) ? 1 : 0;
      if (isSpecialA !== isSpecialB) return isSpecialA - isSpecialB;
      const hasFacA = getSlotFacultyList(a).length > 0 ? 1 : 0;
      const hasFacB = getSlotFacultyList(b).length > 0 ? 1 : 0;
      return hasFacB - hasFacA;
    });
  };

  // Try to fill one empty slot (ck, day, p) under `tier` using Direct -> 1-Slot Swap -> 2-Hop Chain Swap -> Cross-Class Swap
  const tryFillEmptySlotWithTier = (ck, day, p, tier, tierIdx) => {
    const deficitList = getDeficitCandidates(ck);
    if (deficitList.length === 0) return false;

    // Operator 1: Scored direct placement (picks lowest fatigue/best balance candidate)
    const directCandidates = [];
    for (const cand of deficitList) {
      if (!canPlaceSingleInClass(ck, cand, day, p, tier)) continue;
      const facs = getSlotFacultyList(cand);
      let score = 0;
      facs.forEach(f => {
        if (hasAdjacentFacultyHour(f, day, p)) score += 50000;
        if ((p === 4 && !isFacultyFree(f, day, 5)) || (p === 5 && !isFacultyFree(f, day, 4))) score += 30000;
        score += getFacultyDailyHours(f, day) * 2000;
      });
      const timesToday = PERIODS.filter(pr => classGrid[ck][day][pr] && isSameSubjectSlot(classGrid[ck][day][pr], cand)).length;
      score += timesToday * 4000;
      const def = Math.max(0, getAllocHours(cand) - getPlacedCountInClass(ck, cand));
      score -= def * 500;
      if (p === 7 && isMathsOrToughSubject(cand)) score += 20000;
      if (p <= 2 && anySeniorAdmin(facs)) score += 40000;
      directCandidates.push({ cand, score });
    }
    if (directCandidates.length > 0) {
      directCandidates.sort((a, b) => a.score - b.score);
      const best = directCandidates[0].cand;
      const slotObj = buildOccupiedSlotObject(best, p, timings[p] || DEFAULT_TIMINGS[p]);
      classGrid[ck][day][p] = slotObj;
      markSlotBusy(slotObj, ck, day, p);
      return true;
    }

    // Operator 2: 1-Slot Same-Class Swap: empty(day, p) <- donor(donorDay, donorP) <- cand
    for (const cand of deficitList) {
      for (const donorDay of DAYS) {
        for (const donorP of PERIODS) {
          if (donorDay === day && donorP === p) continue;
          const donorSlot = classGrid[ck][donorDay][donorP];
          if (!donorSlot || donorSlot.isPinned || isLabLikeBlock(donorSlot) || donorSlot.isTraining) continue;
          if (isSameSubjectSlot(donorSlot, cand)) continue;

          const tx = [];
          txRemove(ck, donorDay, donorP, tx);
          const donorOk = canPlaceSingleInClass(ck, donorSlot, day, p, tier, { skipQuotaCheck: true });
          const candOk = donorOk && canPlaceSingleInClass(ck, cand, donorDay, donorP, tier);
          if (candOk) {
            txPlace(ck, day, p, { ...donorSlot, period: p, time: timings[p] || DEFAULT_TIMINGS[p] }, tx);
            txPlace(ck, donorDay, donorP, buildOccupiedSlotObject(cand, donorP, timings[donorP] || DEFAULT_TIMINGS[donorP]), tx);
            return true;
          }
          rollbackTx(tx);
        }
      }
    }

    // Operator 3: 2-Hop Same-Class Chain Swap: empty(day,p) <- slotB(dB,pB) <- slotA(dA,pA) <- cand
    if (tierIdx >= 1) {
      const eligibleSlotBs = [];
      for (const dB of DAYS) {
        for (const pB of PERIODS) {
          if (dB === day && pB === p) continue;
          const sB = classGrid[ck][dB][pB];
          if (!sB || sB.isPinned || isLabLikeBlock(sB) || sB.isTraining) continue;
          const probeTx = [];
          txRemove(ck, dB, pB, probeTx);
          const okMove = canPlaceSingleInClass(ck, sB, day, p, tier, { skipQuotaCheck: true });
          rollbackTx(probeTx);
          if (okMove) eligibleSlotBs.push({ dB, pB, slotB: sB });
        }
      }

      for (const { dB, pB, slotB } of eligibleSlotBs) {
        const tx = [];
        txRemove(ck, dB, pB, tx);
        txPlace(ck, day, p, { ...slotB, period: p, time: timings[p] || DEFAULT_TIMINGS[p] }, tx);

        for (const cand of deficitList) {
          for (const dA of DAYS) {
            for (const pA of PERIODS) {
              if ((dA === day && pA === p) || (dA === dB && pA === pB)) continue;
              const slotA = classGrid[ck][dA][pA];
              if (!slotA || slotA.isPinned || isLabLikeBlock(slotA) || slotA.isTraining) continue;
              if (isSameSubjectSlot(slotA, cand)) continue;

              const subTx = [];
              txRemove(ck, dA, pA, subTx);
              const aOk = canPlaceSingleInClass(ck, slotA, dB, pB, tier, { skipQuotaCheck: true });
              const cOk = aOk && canPlaceSingleInClass(ck, cand, dA, pA, tier);
              if (cOk) {
                txPlace(ck, dB, pB, { ...slotA, period: pB, time: timings[pB] || DEFAULT_TIMINGS[pB] }, subTx);
                txPlace(ck, dA, pA, buildOccupiedSlotObject(cand, pA, timings[pA] || DEFAULT_TIMINGS[pA]), subTx);
                return true;
              }
              rollbackTx(subTx);
            }
          }
        }
        rollbackTx(tx);
      }
    }

    // Operator 4: Cross-Class Faculty Liberation (frees cand's faculty busy in blockerCk at (day, p) via swap/move in blockerCk)
    if (tierIdx >= 1) {
      const swapTier = STEP_C_TIERS[Math.min(tierIdx, 2)];
      for (const cand of deficitList) {
        const facs = getSlotFacultyList(cand);
        const busyFacs = facs.filter(f => !isFacultyFree(f, day, p));
        if (busyFacs.length === 0) continue;

        const tx = [];
        let liberatedAll = true;
        for (const bf of busyFacs) {
          const bKey = resolveFacKey(bf);
          const blockerCk = facultyBusy[bKey]?.[day]?.[p];
          if (!blockerCk || blockerCk === ck || !tryRelocateSingleSlotInOtherClass(blockerCk, day, p, facs, swapTier, tx)) {
            liberatedAll = false;
            break;
          }
        }

        if (liberatedAll && canPlaceSingleInClass(ck, cand, day, p, tier)) {
          txPlace(ck, day, p, buildOccupiedSlotObject(cand, p, timings[p] || DEFAULT_TIMINGS[p]), tx);
          return true;
        }
        rollbackTx(tx);
      }
    }

    return false;
  };

  // Sweep tier-by-tier across all target classes until no deficit or no empty slot remains
  const runTieredDeficitSolver = (targetClassKeys = classKeys) => {
    let anyPlaced = false;
    for (let tierIdx = 0; tierIdx < STEP_C_TIERS.length; tierIdx++) {
      const tier = STEP_C_TIERS[tierIdx];
      let progress = true;
      while (progress) {
        progress = false;
        for (const ck of targetClassKeys) {
          if (getDeficitCandidates(ck).length === 0) continue;
          for (const day of DAYS) {
            for (const p of PERIODS) {
              if (classGrid[ck]?.[day]?.[p] !== null) continue;
              if (tryFillEmptySlotWithTier(ck, day, p, tier, tierIdx)) {
                progress = true;
                anyPlaced = true;
              }
            }
          }
        }
      }
    }
    return anyPlaced;
  };

  // Recover missing OR damaged partial Lab and Training blocks without ever splitting or losing hours
  const repairContinuousAllocations = (targetClassKeys = classKeys) => {
    targetClassKeys.forEach(ck => {
      (classGroups[ck]?.allocations || []).forEach(item => {
        if (!isContinuousBlockSubject(item)) return;
        const needed = getAllocHours(item);
        let placed = getPlacedCountInClass(ck, item);
        if (placed >= needed) return;

        const isLab = isLabLikeBlock(item);
        const targetBlocks = [...(item.parsedPattern?.blocks || [])].sort((a, b) => b - a);
        targetBlocks.forEach(blockDur => {
          if (placed + blockDur > needed) return;
          let ok = placeBlockIntoClass(ck, item, blockDur, { isLabPhase: isLab, relaxedPass: false });
          if (!ok) ok = placeBlockIntoClass(ck, item, blockDur, { isLabPhase: isLab, relaxedPass: true, allowClassSecondLab: true, allowLabDisplacement: true });
          if (!ok) ok = rescueBlockIntoClass(ck, item, blockDur, isLab);
          if (ok) placed += blockDur;
        });

        // If a partial/damaged chunk remains (e.g. 1 hour of a 2h block), clear unlocked fragments & rebuild full contiguous block(s)
        placed = getPlacedCountInClass(ck, item);
        if (placed < needed) {
          const tx = [];
          let pinnedCount = 0;
          DAYS.forEach(d => {
            PERIODS.forEach(p => {
              const s = classGrid[ck]?.[d]?.[p];
              if (s && isSameSubjectSlot(s, item)) {
                if (s.isPinned) pinnedCount++;
                else txRemove(ck, d, p, tx);
              }
            });
          });

          if (tx.length > 0) {
            const rebuildTarget = needed - pinnedCount;
            const rebuildParsed = parseSlotPattern(item.slotPattern, rebuildTarget, item.isTraining, item.type, isLab);
            const rebuildBlocks = [...(rebuildParsed.blocks || [])].sort((a, b) => b - a);
            let rebuiltHours = 0;
            let allRebuilt = rebuildBlocks.length > 0;

            for (const blockDur of rebuildBlocks) {
              let ok = placeBlockIntoClass(ck, item, blockDur, { isLabPhase: isLab, relaxedPass: false });
              if (!ok) ok = placeBlockIntoClass(ck, item, blockDur, { isLabPhase: isLab, relaxedPass: true, allowClassSecondLab: true, allowLabDisplacement: true });
              if (!ok) ok = rescueBlockIntoClass(ck, item, blockDur, isLab);
              if (ok) rebuiltHours += blockDur;
              else { allRebuilt = false; break; }
            }

            if (!allRebuilt && rebuiltHours < tx.length) {
              DAYS.forEach(d => PERIODS.forEach(p => {
                const s = classGrid[ck]?.[d]?.[p];
                if (s && !s.isPinned && isSameSubjectSlot(s, item)) {
                  unmarkSlotBusy(s, d, p);
                  classGrid[ck][d][p] = null;
                }
              }));
              rollbackTx(tx);
            }
          }
        }
      });
    });
  };

  const repairLabAllocations = repairContinuousAllocations;

  return {
    facultyBusy,
    resolveFacKey,
    markFacultyBusy,
    unmarkFacultyBusy,
    isFacultyFree,
    markSlotBusy,
    unmarkSlotBusy,
    areAllFacsFree,
    checkSeniorAdmin,
    anySeniorAdmin,
    getFacultyDailyHours,
    doesFacultyHaveBlockOnDay,
    doesFacultyHaveLabOnDay,
    getFacultyTotalScheduledHours,
    canFacultyTakeMoreHours,
    canAllFacsTakeMoreHours,
    getPlacedCountInClass,
    canSubjectTakeMoreHoursInClass,
    getClassBlockCountOnDay,
    hasLabOnDay,
    hasAdjacentFacultyHour,
    getFacultyPeriodCount,
    getSubjectPeriodCount,
    getSubjectMorningCount,
    getSubjectAfternoonCount,
    causesFacultyContinuousFatigue,
    wouldCauseFacultyBlockFatigue,
    canPlaceSingleInClass,
    placeBlockIntoClass,
    rescueBlockIntoClass,
    repairContinuousAllocations,
    repairLabAllocations,
    getDeficitCandidates,
    runTieredDeficitSolver
  };
};

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

    // Load all staff database records to check designations (HOD, Asst HOD, ASP, Prof, AP)
    const allStaffMembers = await Staff.find({ department: department || "CSE" });
    const staffMap = {};
    allStaffMembers.forEach(s => {
      if (s.name) staffMap[s.name.trim().toLowerCase()] = s;
    });

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
        // Sanitize and normalize facultyNames array (strip placeholder "-")
        if (!Array.isArray(a.facultyNames)) {
          a.facultyNames = (a.facultyName && String(a.facultyName).trim() !== "-")
            ? [String(a.facultyName).trim()]
            : [];
        } else {
          a.facultyNames = a.facultyNames.map(f => String(f || "").trim()).filter(f => f && f !== "-");
          if (a.facultyNames.length === 0 && a.facultyName && String(a.facultyName).trim() !== "-") {
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
          if (curr.hoursPerWeek !== undefined && curr.hoursPerWeek !== null && curr.hoursPerWeek !== "") {
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

    // Total allocated hours per faculty across all allocations (preserves explicit 0)
    const facultyMaxWorkloadMap = {};
    allocations.forEach(a => {
      const h = getAllocHours(a);
      getSlotFacultyList(a).forEach(f => {
        const existingKey = Object.keys(facultyMaxWorkloadMap).find(k => isSameFacultyName(k, f));
        const targetKey = existingKey || f;
        facultyMaxWorkloadMap[targetKey] = (facultyMaxWorkloadMap[targetKey] || 0) + h;
      });
    });

    const solver = createGridSolver({
      classGrid,
      classKeys,
      classGroups,
      facultyMaxWorkloadMap,
      staffMap,
      coordinators: savedAlloc?.coordinators,
      timings
    });

    const {
      markFacultyBusy,
      isFacultyFree,
      markSlotBusy,
      areAllFacsFree,
      checkSeniorAdmin,
      anySeniorAdmin,
      getFacultyDailyHours,
      getPlacedCountInClass,
      canSubjectTakeMoreHoursInClass,
      canAllFacsTakeMoreHours,
      hasLabOnDay,
      hasAdjacentFacultyHour,
      getFacultyPeriodCount,
      getSubjectPeriodCount,
      getSubjectMorningCount,
      getSubjectAfternoonCount,
      causesFacultyContinuousFatigue,
      placeBlockIntoClass,
      rescueBlockIntoClass,
      runTieredDeficitSolver
    } = solver;

    const unplacedLabs = [];
    const unplacedTheory = [];

    // --- STEP 0.0: PRE-LOCKED / PINNED INSTITUTIONAL SLOTS ---
    if (existingSchedule && existingSchedule.classes) {
      existingSchedule.classes.forEach(oldCls => {
        const ck = oldCls.classKey;
        if (!classGrid[ck]) return;
        DAYS.forEach(day => {
          (oldCls.days?.[day] || []).forEach(oldSlot => {
            if (oldSlot && oldSlot.isPinned && oldSlot.period) {
              const p = oldSlot.period;
              const facs = oldSlot.facultyNames || (oldSlot.facultyName && oldSlot.facultyName !== "-" ? [oldSlot.facultyName] : []);
              classGrid[ck][day][p] = {
                period: p,
                time: oldSlot.time || timings[p] || DEFAULT_TIMINGS[p],
                subjectCode: oldSlot.subjectCode,
                subjectName: oldSlot.subjectName,
                shortName: oldSlot.shortName || oldSlot.subjectCode,
                facultyName: oldSlot.facultyName || "-",
                facultyNames: facs,
                type: oldSlot.type || "Theory",
                difficulty: oldSlot.difficulty || "Normal",
                room: oldSlot.room || "LH-1",
                isPinned: true
              };
              facs.forEach(f => {
                if (f && f !== "-") markFacultyBusy(f, day, p, ck);
              });

              const matchAlloc = classGroups[ck]?.allocations?.find(a => isSameSubjectSlot(oldSlot, a));
              if (matchAlloc) {
                matchAlloc.placedBlocksHours = (matchAlloc.placedBlocksHours || 0) + 1;
              }
            }
          });
        });
      });
    }

    // 2. Process Fixed Slots from Allocations
    classKeys.forEach(ck => {
      const clsAllocations = classGroups[ck].allocations || [];
      clsAllocations.forEach(alloc => {
        const slotsToFix = Array.isArray(alloc.fixedSlots) ? alloc.fixedSlots : [];
        slotsToFix.forEach(fix => {
          const day = fix.day;
          const p = Number(fix.period);
          if (DAYS.includes(day) && p >= 1 && p <= 7 && classGrid[ck][day][p] === null) {
            const facs = alloc.facultyNames || (alloc.facultyName && alloc.facultyName !== "-" ? [alloc.facultyName] : []);
            classGrid[ck][day][p] = {
              period: p,
              time: timings[p] || DEFAULT_TIMINGS[p],
              subjectCode: alloc.subjectCode,
              subjectName: alloc.subjectName,
              shortName: alloc.shortName || alloc.subjectCode,
              facultyName: facs.join(", ") || "-",
              facultyNames: facs,
              type: alloc.type || "Theory",
              difficulty: alloc.difficulty || "Normal",
              room: alloc.room || (isLibraryItem(alloc) ? "Library" : (isLabLikeBlock(alloc) ? "Lab" : "LH-1")),
              isPinned: true
            };
            facs.forEach(f => {
              if (f && f !== "-") markFacultyBusy(f, day, p, ck);
            });
            alloc.placedBlocksHours = (alloc.placedBlocksHours || 0) + 1;
          }
        });
      });
    });

    // --- STEP 0: CLASS ADVISOR SUBJECT ON MONDAY PERIOD 1 ---
    classKeys.forEach(ck => {
      const advisor = classAdvisors && classAdvisors[ck];
      if (!advisor) return;
      if (!isFacultyFree(advisor, "Monday", 1) || checkSeniorAdmin(advisor)) return;

      const classTheorySubjs = classGroups[ck].allocations.filter(a => isPureTheorySubject(a) && getAllocHours(a) > 0);
      // Strongly prefer regular 1-hour core theory over continuous block subjects for Monday Period 1
      const advisorSubj =
        classTheorySubjs.find(a => !a.isTraining && (!a.slotPattern || a.slotPattern === "regular") && (a.facultyNames || []).some(fn => isSameFacultyName(fn, advisor))) ||
        classTheorySubjs.find(a => (a.facultyNames || []).some(fn => isSameFacultyName(fn, advisor)));

      if (advisorSubj && classGrid[ck]["Monday"][1] === null) {
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
    });

    // Precompute parsed block chunks for every continuous / lab allocation
    const wave1LabTasks = [];
    const wave2ContinuousTasks = [];
    classKeys.forEach(ck => {
      classGroups[ck].allocations.forEach(item => {
        const hours = getAllocHours(item);
        const isLab = isLabLikeBlock(item);
        const parsed = parseSlotPattern(item.slotPattern, hours, item.isTraining, item.type, isLab);
        item.parsedPattern = parsed;
        item.placedBlocksHours = getPlacedCountInClass(ck, item);
        item.placedBlockDays = DAYS.filter(d => PERIODS.some(p => classGrid[ck][d][p] && isSameSubjectSlot(classGrid[ck][d][p], item)));

        if (parsed.blocks && parsed.blocks.length > 0) {
          // Account for any already-pinned block hours before queueing remaining blocks
          let alreadyPlaced = item.placedBlocksHours;
          parsed.blocks.forEach(blockDur => {
            if (alreadyPlaced >= blockDur) {
              alreadyPlaced -= blockDur;
              return;
            }
            const task = { ck, item, blockDur };
            if (isLab) wave1LabTasks.push(task);
            else wave2ContinuousTasks.push(task);
          });
        }
      });
    });

    // --- WAVE 1: PLACE ALL PHYSICAL LABS & PROJECTS FIRST ACROSS ALL CLASSES (3h blocks before 2h blocks) ---
    wave1LabTasks.sort((a, b) => b.blockDur - a.blockDur);
    const failedLabTasks = [];
    wave1LabTasks.forEach(({ ck, item, blockDur }) => {
      let ok = placeBlockIntoClass(ck, item, blockDur, { isLabPhase: true, relaxedPass: false });
      if (!ok) {
        ok = placeBlockIntoClass(ck, item, blockDur, { isLabPhase: true, relaxedPass: true, allowClassSecondLab: false });
      }
      if (!ok) {
        ok = placeBlockIntoClass(ck, item, blockDur, { isLabPhase: true, relaxedPass: true, allowClassSecondLab: true, allowLabDisplacement: true });
      }
      if (!ok) {
        ok = rescueBlockIntoClass(ck, item, blockDur, true);
      }
      if (!ok) {
        failedLabTasks.push({ ck, item, blockDur });
      }
    });

    // Retry any deferred Lab block once more now that initial single placements/swaps settled
    failedLabTasks.forEach(({ ck, item, blockDur }) => {
      const ok = rescueBlockIntoClass(ck, item, blockDur, true);
      if (!ok) {
        unplacedLabs.push({ classKey: ck, subject: item.subjectName, faculty: getSlotFacultyList(item).join(", ") });
      }
    });

    // --- WAVE 2: PLACE CONTINUOUS TRAINING / THEORY BLOCKS (e.g. DAA 2+2, WD 2+2, CDS 2+1, CCP-1) ---
    wave2ContinuousTasks.sort((a, b) => b.blockDur - a.blockDur);
    wave2ContinuousTasks.forEach(({ ck, item, blockDur }) => {
      let ok = placeBlockIntoClass(ck, item, blockDur, { isLabPhase: false, relaxedPass: false });
      if (!ok) {
        ok = placeBlockIntoClass(ck, item, blockDur, { isLabPhase: false, relaxedPass: true, allowLabDisplacement: true });
      }
      if (!ok) {
        rescueBlockIntoClass(ck, item, blockDur, false);
      }
    });

    // --- STEP B: PLACE THEORY, SEMINAR, LIBRARY, & CUSTOM SUBJECTS ---
    // Phase 1 preserves strict faculty rest breaks & balanced distribution;
    // Phase 2 relaxes daily fatigue cap for remaining hours when workload > 15h/wk before Step C.
    classKeys.forEach(ck => {
      const classTheory = [];

      // Count ONLY non-Senior-Admin pure core theory subjects so HOD/ASP don't shrink P1 slots and starve Period 1
      const eligibleP1TheoryCodes = new Set(
        classGroups[ck].allocations
          .filter(a => isPureTheorySubject(a) && getAllocHours(a) > 0 && !anySeniorAdmin(getSlotFacultyList(a)))
          .map(a => a.subjectCode)
      );
      const maxAllowedP1PerSubject = eligibleP1TheoryCodes.size >= 5 ? 1 : Math.ceil(5 / Math.max(1, eligibleP1TheoryCodes.size));

      classGroups[ck].allocations.forEach(a => {
        const isBlockSubj = isContinuousBlockSubject(a);
        const totalNeeded = getAllocHours(a);
        if (totalNeeded <= 0) return;

        // NEVER shatter unplaced multi-period blocks (Labs & Training) into single 1-hour periods; only explicit "+1" singles may run in Step B
        if (isBlockSubj) {
          const explicitSingles = a.parsedPattern?.singles || 0;
          const blockTargetSum = (a.parsedPattern?.blocks || []).reduce((s, b) => s + b, 0);
          const placedSingles = Math.max(0, getPlacedCountInClass(ck, a) - blockTargetSum);
          const remainingExplicitSingles = Math.max(0, explicitSingles - placedSingles);
          if (remainingExplicitSingles > 0) {
            classTheory.push({
              ...(a.toObject ? a.toObject() : a),
              requiredHours: remainingExplicitSingles,
              hoursAssigned: 0
            });
          }
          return;
        }

        const placedSoFar = getPlacedCountInClass(ck, a);
        const remainingSingleHours = Math.max(0, totalNeeded - placedSoFar);

        if (remainingSingleHours > 0) {
          classTheory.push({
            ...(a.toObject ? a.toObject() : a),
            requiredHours: remainingSingleHours,
            hoursAssigned: 0
          });
        }
      });

      const runStepBPass = ({ relaxFatigue = false }) => {
        let assignedInRound = true;
        while (assignedInRound) {
          assignedInRound = false;
          const roundSubjs = [...classTheory].sort(() => Math.random() - 0.5);

          for (const subj of roundSubjs) {
            if (subj.hoursAssigned >= subj.requiredHours) continue;

            const facs = getSlotFacultyList(subj);
            const candidateSlots = [];

            DAYS.forEach(day => {
              PERIODS.forEach(p => {
                if (classGrid[ck][day][p] !== null) return;
                if (!areAllFacsFree(facs, day, p)) return;

                const leftSlot = p > 1 ? classGrid[ck][day][p - 1] : null;
                const rightSlot = p < 7 ? classGrid[ck][day][p + 1] : null;
                if ((leftSlot && isSameSubjectSlot(leftSlot, subj)) || (rightSlot && isSameSubjectSlot(rightSlot, subj))) {
                  return;
                }

                if (isPhysicalLab(subj) && (hasLabOnDay(ck, day) || p === 1)) {
                  return;
                }

                let score = 0;
                if (p === 1) {
                  if (!isPureTheorySubject(subj)) return;
                  if (anySeniorAdmin(facs)) return;
                  if (!relaxFatigue && getSubjectPeriodCount(ck, subj.subjectCode, 1) >= maxAllowedP1PerSubject) return;
                  const p1SameSubjCount = getSubjectPeriodCount(ck, subj.subjectCode, 1);
                  if (p1SameSubjCount >= Math.max(2, maxAllowedP1PerSubject)) return;
                  score += p1SameSubjCount * 2500;
                  if (facs.some(f => getFacultyPeriodCount(f, 1) >= 2)) score += 5000;
                  score -= 1500;
                }

                if (p === 2 && anySeniorAdmin(facs)) return;

                if (isMathsOrToughSubject(subj)) {
                  if (p === 7) return;
                  if (p === 6) score += 8500;
                  if (p <= 3) score -= 400;
                } else if (subj.difficulty === "Light") {
                  if (p >= 6) score -= 500;
                  else if (p === 5) score -= 300;
                  else if (p <= 3) score += 1500;
                } else if (p === 7) {
                  score += 150;
                }

                // Mandatory rest breaks in strict pass; heavy penalty + safe daily cap in relaxed pass
                if (!relaxFatigue) {
                  if (facs.some(f => causesFacultyContinuousFatigue(f, day, p))) return;
                  if (facs.some(f => p === 4 && (!isFacultyFree(f, day, 5) && !isFacultyFree(f, day, 6)))) return;
                } else {
                  if (facs.some(f => getFacultyDailyHours(f, day) >= 5)) return;
                }

                facs.forEach(f => {
                  const dailyHours = getFacultyDailyHours(f, day);
                  if (dailyHours >= 3) score += 12000;
                  else if (dailyHours === 2) score += 3500;
                  else if (dailyHours === 1) score += 800;
                  else score -= 2000;

                  if (hasAdjacentFacultyHour(f, day, p)) score += 50000;
                  if ((p === 4 && !isFacultyFree(f, day, 5)) || (p === 5 && !isFacultyFree(f, day, 4))) score += 25000;
                });

                const classHoursOfThisSubjToday = PERIODS.filter(pr =>
                  classGrid[ck][day][pr] && isSameSubjectSlot(classGrid[ck][day][pr], subj)
                ).length;
                const isLibOrSem = isLibraryItem(subj) || isSeminarItem(subj);
                const maxAllowedToday = isLibOrSem
                  ? 1
                  : (relaxFatigue ? 2 : Math.max(1, Math.ceil((subj.requiredHours || 4) / 5)));
                if (classHoursOfThisSubjToday >= maxAllowedToday) return;
                score += classHoursOfThisSubjToday * 6000;

                const subjSamePeriod = getSubjectPeriodCount(ck, subj.subjectCode, p);
                if (subjSamePeriod >= 1) score += subjSamePeriod * 3500;

                facs.forEach(f => {
                  const facSamePeriodCount = getFacultyPeriodCount(f, p);
                  if (facSamePeriodCount >= 1) score += facSamePeriodCount * 1200;
                });

                const morningCount = getSubjectMorningCount(ck, subj.subjectCode);
                const afternoonCount = getSubjectAfternoonCount(ck, subj.subjectCode);
                if (p <= 4 && morningCount >= 3) score += 400;
                if (p >= 5 && afternoonCount >= 2) score += 300;

                score += Math.floor(Math.random() * 60);
                candidateSlots.push({ day, period: p, score });
              });
            });

            if (candidateSlots.length > 0) {
              candidateSlots.sort((a, b) => a.score - b.score);
              const { day, period: p } = candidateSlots[0];
              const slotObj = buildOccupiedSlotObject(subj, p, timings[p] || DEFAULT_TIMINGS[p]);
              classGrid[ck][day][p] = slotObj;
              markSlotBusy(slotObj, ck, day, p);
              subj.hoursAssigned++;
              assignedInRound = true;
            }
          }
        }
      };

      runStepBPass({ relaxFatigue: false });
      if (classTheory.some(s => s.hoursAssigned < s.requiredHours)) {
        runStepBPass({ relaxFatigue: true });
      }
    });

    // --- GUARANTEE PASS: Ensure Period 1 has a Core Theory Subject on all 5 days ---
    classKeys.forEach(ck => {
      DAYS.forEach(day => {
        if (classGrid[ck][day][1] !== null) return;
        const theoryCandidates = classGroups[ck].allocations
          .filter(a => isPureTheorySubject(a) && canSubjectTakeMoreHoursInClass(ck, a))
          .sort((a, b) => (getAllocHours(b) - getPlacedCountInClass(ck, b)) - (getAllocHours(a) - getPlacedCountInClass(ck, a)));

        for (const allowAdjacentFac of [false, true]) {
          if (classGrid[ck][day][1] !== null) break;
          for (const cand of theoryCandidates) {
            const facs = getSlotFacultyList(cand);
            if (!canSubjectTakeMoreHoursInClass(ck, cand)) continue;
            if (!allowAdjacentFac && !canAllFacsTakeMoreHours(facs)) continue;
            if (!areAllFacsFree(facs, day, 1)) continue;
            if (anySeniorAdmin(facs)) continue;
            if (!allowAdjacentFac && facs.some(f => causesFacultyContinuousFatigue(f, day, 1))) continue;
            if (classGrid[ck][day][2] && isSameSubjectSlot(classGrid[ck][day][2], cand)) continue;
            const timesToday = PERIODS.filter(pr => classGrid[ck][day][pr] && isSameSubjectSlot(classGrid[ck][day][pr], cand)).length;
            if (timesToday >= 2) continue;

            const slotObj = buildOccupiedSlotObject(cand, 1, timings[1] || DEFAULT_TIMINGS[1]);
            classGrid[ck][day][1] = slotObj;
            markSlotBusy(slotObj, ck, day, 1);
            break;
          }
        }
      });
    });

    // --- STEP C: TIERED ZERO-WASTED-FREE SOLVER (DIRECT + 1-SWAP + 2-HOP SWAP + CROSS-CLASS LIBERATION) ---
    runTieredDeficitSolver(classKeys);

    // Fill any truly unallocated spare slots with allocated LIB/SEM under quota or clean FREE
    classKeys.forEach(ck => {
      const clsAllocations = classGroups[ck].allocations || [];
      DAYS.forEach(day => {
        PERIODS.forEach(p => {
          if (classGrid[ck][day][p] !== null) return;

          const libItems = clsAllocations.filter(isLibraryItem);
          const semItems = clsAllocations.filter(isSeminarItem);
          const libItem = libItems[0];
          const semItem = semItems[0];

          const libMaxAllowed = libItems.reduce((sum, a) => sum + getAllocHours(a), 0);
          const libPlacedTotal = DAYS.reduce((acc, d) => acc + PERIODS.filter(pr => classGrid[ck][d][pr] && isLibraryItem(classGrid[ck][d][pr])).length, 0);
          const canTakeLib = Boolean(libItem) && libPlacedTotal < libMaxAllowed;

          const semMaxAllowed = semItems.reduce((sum, a) => sum + getAllocHours(a), 0);
          const semPlacedTotal = DAYS.reduce((acc, d) => acc + PERIODS.filter(pr => classGrid[ck][d][pr] && isSeminarItem(classGrid[ck][d][pr])).length, 0);
          const canTakeSem = Boolean(semItem) && semPlacedTotal < semMaxAllowed;

          const hasLibToday = PERIODS.some(pr => classGrid[ck][day][pr] && isLibraryItem(classGrid[ck][day][pr]));
          const hasSemToday = PERIODS.some(pr => classGrid[ck][day][pr] && isSeminarItem(classGrid[ck][day][pr]));

          if (p !== 1 && !hasLibToday && canTakeLib) {
            classGrid[ck][day][p] = buildOccupiedSlotObject({
              subjectCode: libItem.subjectCode || "LIB",
              subjectName: libItem.subjectName || "Library / Digital Library",
              shortName: libItem.shortName || "LIB",
              facultyNames: [],
              type: "Library",
              difficulty: "Light",
              room: "Library"
            }, p, timings[p] || DEFAULT_TIMINGS[p]);
          } else if (p !== 1 && !hasSemToday && canTakeSem) {
            classGrid[ck][day][p] = buildOccupiedSlotObject({
              subjectCode: semItem.subjectCode || "SEM",
              subjectName: semItem.subjectName || "Seminar / Technical Presentation",
              shortName: semItem.shortName || "SEM",
              facultyNames: [],
              type: "Seminar",
              difficulty: "Light",
              room: "Seminar Hall"
            }, p, timings[p] || DEFAULT_TIMINGS[p]);
          } else {
            classGrid[ck][day][p] = makeFreeSlot(p, timings[p] || DEFAULT_TIMINGS[p]);
          }
        });
      });
    });

    // Post-Step-C accurate diagnostics across every section
    const classSummary = classKeys.map(ck => {
      const allocs = classGroups[ck].allocations || [];
      let allocatedHours = 0;
      let placedHours = 0;
      let freeHours = 0;
      const unplacedSubjects = [];

      allocs.forEach(a => {
        const req = getAllocHours(a);
        allocatedHours += req;
        const placed = getPlacedCountInClass(ck, a);
        if (placed < req) {
          unplacedSubjects.push({
            subjectCode: a.subjectCode,
            subjectName: a.subjectName,
            faculty: getSlotFacultyList(a).join(", "),
            placed,
            required: req
          });
          if (!isLabLikeBlock(a)) {
            unplacedTheory.push({
              classKey: ck,
              subject: a.subjectName,
              faculty: getSlotFacultyList(a).join(", "),
              assigned: placed,
              required: req
            });
          }
        }
      });

      DAYS.forEach(d => {
        PERIODS.forEach(p => {
          const sl = classGrid[ck][d][p];
          if (!sl || isFreeSlot(sl)) freeHours++;
          else placedHours++;
        });
      });

      return { classKey: ck, allocatedHours, placedHours, freeHours, unplacedSubjects };
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

    // Populate faculty schedule from classGrid (normalized across staff names)
    finalClasses.forEach(cls => {
      DAYS.forEach(day => {
        cls.days[day].forEach(slot => {
          if (!slot || isFreeSlot(slot)) return;
          const facList = getSlotFacultyList(slot);
          facList.forEach(fac => {
            let targetKey = fac;
            if (!facultySchedules[targetKey]) {
              const matchedKey = Object.keys(facultySchedules).find(k => isSameFacultyName(k, fac));
              if (matchedKey) targetKey = matchedKey;
            }
            if (!facultySchedules[targetKey]) {
              facultySchedules[targetKey] = {
                name: targetKey,
                designation: "Faculty",
                theoryCount: 0,
                labCount: 0,
                totalHours: 0,
                days: { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] }
              };
              DAYS.forEach(d => {
                facultySchedules[targetKey].days[d] = PERIODS.map(p => ({
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
            if (facultySchedules[targetKey].days[day]?.[periodIdx]) {
              facultySchedules[targetKey].days[day][periodIdx] = {
                period: slot.period,
                time: slot.time,
                occupied: true,
                classKey: cls.classKey,
                subjectName: slot.subjectName,
                shortName: slot.shortName,
                type: slot.type
              };
              facultySchedules[targetKey].totalHours++;
            }
          });
        });
      });
    });

    // Calculate unique Theory count & Lab count per faculty
    allocations.forEach(item => {
      const facs = getSlotFacultyList(item);
      facs.forEach(fac => {
        const matchedFac = facultySchedules[fac]
          ? fac
          : Object.keys(facultySchedules).find(k => isSameFacultyName(k, fac));
        if (matchedFac && facultySchedules[matchedFac]) {
          if (isLabLikeBlock(item)) facultySchedules[matchedFac].labCount++;
          else if ((item.type || "").toLowerCase() === "theory") facultySchedules[matchedFac].theoryCount++;
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
      classSummary,
      message: "Clash-Free Timetable Generated Successfully!"
    });
  } catch (err) {
    console.error("Timetable Generation Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Helper: Rebuild faculty schedules across all staff members from classes in doc
const buildFacultySchedules = async (doc, department) => {
  const allStaffMembers = await Staff.find({ department: department || doc.department || "CSE" });
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

  (doc.classes || []).forEach(cItem => {
    DAYS.forEach(d => {
      const daySlots = (cItem.days && (cItem.days[d] || (typeof cItem.days.get === "function" && cItem.days.get(d)))) || [];
      daySlots.forEach(slot => {
        if (!slot || slot.type === "Free" || slot.subjectCode === "FREE") return;
        const facList = slot.facultyNames && slot.facultyNames.length > 0 ? slot.facultyNames : (slot.facultyName ? [slot.facultyName] : []);
        facList.forEach(fac => {
          const cleanFac = String(fac || "").trim();
          if (!cleanFac || cleanFac === "-") return;
          let targetKey = cleanFac;
          if (!facultySchedules[targetKey]) {
            const matchedKey = Object.keys(facultySchedules).find(k => isSameFacultyName(k, cleanFac));
            if (matchedKey) targetKey = matchedKey;
          }
          if (!facultySchedules[targetKey]) {
            facultySchedules[targetKey] = {
              name: targetKey,
              designation: "Assistant Professor",
              theoryCount: 0,
              labCount: 0,
              totalHours: 0,
              days: { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] }
            };
            DAYS.forEach(d2 => {
              facultySchedules[targetKey].days[d2] = PERIODS.map(p2 => ({
                period: p2,
                time: DEFAULT_TIMINGS[p2],
                occupied: false,
                classKey: "",
                subjectName: "",
                type: "Free"
              }));
            });
          }
          if (facultySchedules[targetKey]) {
            const periodIdx = slot.period - 1;
            if (facultySchedules[targetKey].days[d] && facultySchedules[targetKey].days[d][periodIdx]) {
              facultySchedules[targetKey].days[d][periodIdx] = {
                period: slot.period,
                time: slot.time || DEFAULT_TIMINGS[slot.period],
                occupied: true,
                classKey: cItem.classKey,
                subjectCode: slot.subjectCode,
                subjectName: slot.subjectName,
                shortName: slot.shortName || slot.subjectCode,
                type: slot.type,
                isTraining: !!slot.isTraining || (slot.type || "").toLowerCase().includes("training")
              };
              facultySchedules[targetKey].totalHours++;
              if (slot.type === "Laboratory" || slot.type === "Lab") facultySchedules[targetKey].labCount = (facultySchedules[targetKey].labCount || 0) + 1;
              else facultySchedules[targetKey].theoryCount = (facultySchedules[targetKey].theoryCount || 0) + 1;
            }
          }
        });
      });
    });
  });

  return facultySchedules;
};

// Helper: Prunes any subjects (or stale/unallocated Library & Seminar slots) exceeding allocated hoursPerWeek
const sanitizeExcessSubjectHours = async (schedule, department) => {
  if (!schedule || !schedule.classes || schedule.classes.length === 0 || schedule.isLocked) {
    return false;
  }

  const allocDoc = await TimetableAllocation.findOne({
    department: department || schedule.department || "CSE",
    academicYear: schedule.academicYear || "2026-2027",
    semesterType: schedule.semesterType || "Even"
  });
  const allAllocations = allocDoc?.allocations || [];
  let modified = false;

  schedule.classes.forEach(cls => {
    const classAllocs = allAllocations.filter(a => matchesClassAllocation(a, cls));

    // 1. Prune every allocated subject strictly down to its configured hoursPerWeek
    classAllocs.forEach(allocItem => {
      const subjCode = allocItem.subjectCode || allocItem.code || allocItem.shortName;
      if (!subjCode || subjCode === "FREE" || subjCode === "MENTOR") return;

      const maxAllowed = getAllocHours(allocItem);
      const placedSlots = [];
      DAYS.forEach(day => {
        const dayArr = cls.days?.[day] || [];
        dayArr.forEach(slot => {
          if (slot && isSameSubjectSlot(slot, allocItem)) {
            placedSlots.push({ day, period: slot.period, slot });
          }
        });
      });

      if (placedSlots.length > maxAllowed) {
        let excessCount = placedSlots.length - maxAllowed;
        const singleSlots = placedSlots.filter(p => !p.slot.isTraining && !isLabLikeBlock(p.slot) && !p.slot.isPinned);
        const candidatesToRemove = singleSlots.length >= excessCount ? singleSlots : placedSlots.filter(p => !p.slot.isPinned);

        for (let i = candidatesToRemove.length - 1; i >= 0 && excessCount > 0; i--) {
          const item = candidatesToRemove[i];
          const dayArr = cls.days?.[item.day] || [];
          const slotIdx = dayArr.findIndex(s => s.period === item.period);
          if (slotIdx !== -1) {
            dayArr[slotIdx] = makeFreeSlot(item.period, item.slot.time);
            modified = true;
            excessCount--;
          }
        }
      }
    });

    // 2. Enforce global Library & Seminar weekly cap (even if unallocated or stale from prior schedule)
    const pruneSpecialExcess = (predicate, expectedMax) => {
      const matched = [];
      DAYS.forEach(day => {
        const dayArr = cls.days?.[day] || [];
        dayArr.forEach(slot => {
          if (slot && slot.type !== "Free" && slot.subjectCode !== "FREE" && predicate(slot)) {
            matched.push({ day, period: slot.period, slot });
          }
        });
      });
      if (matched.length > expectedMax) {
        let excess = matched.length - expectedMax;
        const removable = matched.filter(m => !m.slot.isPinned);
        for (let i = removable.length - 1; i >= 0 && excess > 0; i--) {
          const m = removable[i];
          const dayArr = cls.days?.[m.day] || [];
          const sIdx = dayArr.findIndex(s => s.period === m.period);
          if (sIdx !== -1) {
            dayArr[sIdx] = makeFreeSlot(m.period, m.slot.time);
            modified = true;
            excess--;
          }
        }
      }
    };

    if (allAllocations.length > 0) {
      const expectedLib = classAllocs.filter(isLibraryItem).reduce((s, a) => s + getAllocHours(a), 0);
      const expectedSem = classAllocs.filter(isSeminarItem).reduce((s, a) => s + getAllocHours(a), 0);
      pruneSpecialExcess(isLibraryItem, expectedLib);
      pruneSpecialExcess(isSeminarItem, expectedSem);
    }

    // 3. Prune duplicate non-faculty filler slots on the same day ONLY if unallocated OR exceeding allocated weekly hours
    DAYS.forEach(day => {
      const dayArr = cls.days?.[day] || [];
      const seenElectives = {};
      dayArr.forEach((slot, slotIdx) => {
        if (!slot || slot.type === "Free" || slot.subjectCode === "FREE" || slot.isPinned) return;
        const code = (slot.shortName || slot.subjectCode || "").toUpperCase();
        const isFillerNoFac = code === "OE" || code === "OPEN ELECTIVE" || ((!slot.facultyName || slot.facultyName === "-") && (slot.type === "Theory" || slot.type === "Elective"));
        if (!isFillerNoFac) return;

        const matchedAlloc = classAllocs.find(a => isSameSubjectSlot(slot, a));
        const weeklyCount = DAYS.reduce((acc, d) => acc + (cls.days?.[d] || []).filter(s => s && !isFreeSlot(s) && ((s.shortName || s.subjectCode || "").toUpperCase() === code)).length, 0);
        const maxWeekly = matchedAlloc ? getAllocHours(matchedAlloc) : 0;

        if (seenElectives[code] && (!matchedAlloc || weeklyCount > maxWeekly)) {
          dayArr[slotIdx] = makeFreeSlot(slot.period, slot.time);
          modified = true;
        } else {
          seenElectives[code] = true;
        }
      });
    });
  });

  return modified;
};

// Helper: Auto-fills remaining FREE slots, consolidates any split Labs, and recovers deficit hours
const healScheduleFreeSlots = async (schedule, department) => {
  if (!schedule || !schedule.classes || schedule.classes.length === 0 || schedule.isLocked) {
    return false;
  }

  const allocDoc = await TimetableAllocation.findOne({
    department: department || schedule.department || "CSE",
    academicYear: schedule.academicYear || "2026-2027",
    semesterType: schedule.semesterType || "Even"
  });
  const allAllocations = allocDoc?.allocations || [];

  const allStaffMembers = await Staff.find({ department: department || schedule.department || "CSE" });
  const staffMap = {};
  allStaffMembers.forEach(s => {
    if (s.name) staffMap[s.name.trim().toLowerCase()] = s;
  });

  let modified = false;

  // Clean any legacy "TUT" or "MENTOR" placeholder slots to clean "Free"
  schedule.classes.forEach(cls => {
    DAYS.forEach(day => {
      const slots = cls.days?.[day] || [];
      slots.forEach((s, idx) => {
        if (s) {
          const sc = (s.subjectCode || "").toUpperCase();
          const sn = (s.shortName || "").toUpperCase();
          if (sc === "TUT" || sn === "TUT" || sc === "MENTOR" || sn === "MENTOR") {
            slots[idx] = makeFreeSlot(s.period || (idx + 1), s.time);
            modified = true;
          }
        }
      });
    });
  });

  // Build normalized busy faculty matrix across all classes (cleanFacString ignores dot/space inconsistencies)
  const busyFac = {};
  DAYS.forEach(d => {
    busyFac[d] = {};
    PERIODS.forEach(p => {
      busyFac[d][p] = new Set();
    });
  });

  const addFacBusy = (fac, day, p) => {
    const k = cleanFacString(fac);
    if (k && busyFac[day]?.[p]) busyFac[day][p].add(k);
  };
  const delFacBusy = (fac, day, p) => {
    const k = cleanFacString(fac);
    if (k && busyFac[day]?.[p]) busyFac[day][p].delete(k);
  };
  const hasFacBusy = (fac, day, p) => {
    const k = cleanFacString(fac);
    return Boolean(k && busyFac[day]?.[p]?.has(k));
  };

  schedule.classes.forEach(cls => {
    DAYS.forEach(day => {
      const slots = cls.days?.[day] || [];
      slots.forEach(s => {
        if (s && s.type !== "Free" && s.subjectCode !== "FREE" && s.shortName !== "FREE") {
          const facs = s.facultyNames || (s.facultyName ? [s.facultyName] : []);
          facs.forEach(f => addFacBusy(f, day, s.period));
        }
      });
    });
  });

  // --- PASS 0: CONSOLIDATE SPLIT BLOCKS (Repair any unlocked Lab OR Training scattered across single days back into continuous blocks) ---
  schedule.classes.forEach(cls => {
    const classAllocs = allAllocations.filter(a => matchesClassAllocation(a, cls));
    const multiAllocs = classAllocs.filter(a => isContinuousBlockSubject(a) && getAllocHours(a) >= 2);

    multiAllocs.forEach(labAlloc => {
      const pat = (labAlloc.slotPattern || "").trim().toLowerCase();
      // Skip only if explicit single-hour "+1" split was requested for 3h (e.g. 2+1) AND only 1 single exists
      const byDay = {};
      DAYS.forEach(d => {
        byDay[d] = [];
        (cls.days?.[d] || []).forEach((s, idx) => {
          if (s && !s.isPinned && isSameSubjectSlot(s, labAlloc)) {
            byDay[d].push({ day: d, idx, period: s.period || (idx + 1), slot: s });
          }
        });
      });

      const isolatedSingles = [];
      DAYS.forEach(d => {
        byDay[d].forEach(item => {
          const hasAdjacentPartner = byDay[d].some(other => Math.abs(other.period - item.period) === 1);
          if (!hasAdjacentPartner) isolatedSingles.push(item);
        });
      });

      if (isolatedSingles.length < 2) return;

      const labFacs = labAlloc.facultyNames && labAlloc.facultyNames.length > 0
        ? labAlloc.facultyNames
        : (labAlloc.facultyName ? [labAlloc.facultyName] : []);

      // Try pairing 2 (or 3 if 3 isolated singles exist for a 3-hr regular lab) isolated slots into continuous blocks
      while (isolatedSingles.length >= 2) {
        const wantThree = isolatedSingles.length === 3 && getAllocHours(labAlloc) === 3 && !pat.includes("2");
        const chunk = wantThree ? isolatedSingles.slice(0, 3) : isolatedSingles.slice(0, 2);
        const candidateBlocks = wantThree
          ? [[5, 6, 7], [2, 3, 4]]
          : [[1, 2], [3, 4], [5, 6], [6, 7]];

        // Temporarily vacate chunk slots so they can act as swap destinations
        chunk.forEach(item => {
          const arr = cls.days[item.day];
          labFacs.forEach(f => delFacBusy(f, item.day, item.period));
          arr[item.idx] = makeFreeSlot(item.period, item.slot.time);
        });

        let consolidated = false;
        for (const allowSecondLabDay of [false, true]) {
          if (consolidated) break;
          for (const targetDay of DAYS) {
            if (consolidated) break;
            const targetDayArr = cls.days[targetDay] || [];
            if (!allowSecondLabDay && targetDayArr.some(s => s && isPhysicalLab(s) && !isSameSubjectSlot(s, labAlloc))) {
              continue;
            }

            for (const blockPeriods of candidateBlocks) {
              const minP = Math.min(...blockPeriods);
              const maxP = Math.max(...blockPeriods);

              const labFacsReady = labFacs.every(f => {
                if (!f || f === "-") return true;
                if (minP <= 2 && isSeniorAdminFaculty(f, staffMap)) return false;
                if (blockPeriods.some(bp => hasFacBusy(f, targetDay, bp))) return false;
                if (minP > 1 && hasFacBusy(f, targetDay, minP - 1)) return false;
                if (maxP < 7 && hasFacBusy(f, targetDay, maxP + 1)) return false;
                if (minP === 5 && hasFacBusy(f, targetDay, 4)) return false;
                if (maxP === 4 && hasFacBusy(f, targetDay, 5)) return false;
                return true;
              });
              if (!labFacsReady) continue;

              const blockEntries = blockPeriods.map(bp => {
                const bIdx = targetDayArr.findIndex(x => (x.period || 0) === bp);
                return { period: bp, idx: bIdx, slot: bIdx !== -1 ? targetDayArr[bIdx] : null };
              });
              if (blockEntries.some(e => e.idx === -1)) continue;

              const blockers = blockEntries.filter(e =>
                e.slot && e.slot.type !== "Free" && e.slot.subjectCode !== "FREE" && e.slot.shortName !== "FREE"
              );
              if (blockers.some(b => b.slot.isPinned || isLabLikeBlock(b.slot) || b.slot.isTraining || isContinuousBlockSubject(b.slot))) continue;

              const destPool = [];
              chunk.forEach(cItem => destPool.push({ day: cItem.day, idx: cItem.idx, period: cItem.period }));
              DAYS.forEach(fd => {
                (cls.days[fd] || []).forEach((fs, fIdx) => {
                  const fp = fs.period || (fIdx + 1);
                  if (fd === targetDay && blockPeriods.includes(fp)) return;
                  if (destPool.some(dp => dp.day === fd && dp.period === fp)) return;
                  if (fs.type === "Free" || fs.subjectCode === "FREE") {
                    destPool.push({ day: fd, idx: fIdx, period: fp });
                  }
                });
              });

              const movePlan = [];
              const usedDests = new Set();
              const plannedFacSlots = new Set();
              let allBlockersMovable = true;

              for (const b of blockers) {
                const bSlot = b.slot;
                const bFac = (bSlot.facultyNames && bSlot.facultyNames[0]) || bSlot.facultyName || "";
                const bFacKey = cleanFacString(bFac);
                let pickedDest = null;

                for (const dest of destPool) {
                  const destKey = `${dest.day}_${dest.period}`;
                  if (usedDests.has(destKey)) continue;
                  if (dest.period === 1 && !isPureTheorySubject(bSlot)) continue;
                  if (dest.period === 7 && isMathsOrToughSubject(bSlot)) continue;

                  const dArr = cls.days[dest.day];
                  const left = dArr.find(x => x.period === dest.period - 1);
                  const right = dArr.find(x => x.period === dest.period + 1);
                  if ((left && isSameSubjectSlot(left, bSlot)) || (right && isSameSubjectSlot(right, bSlot))) continue;

                  if (bFacKey) {
                    if (dest.period <= 2 && isSeniorAdminFaculty(bFac, staffMap)) continue;
                    if (hasFacBusy(bFac, dest.day, dest.period) || plannedFacSlots.has(`${bFacKey}_${dest.day}_${dest.period}`)) continue;
                    if (dest.period > 1 && (hasFacBusy(bFac, dest.day, dest.period - 1) || plannedFacSlots.has(`${bFacKey}_${dest.day}_${dest.period - 1}`))) continue;
                    if (dest.period < 7 && (hasFacBusy(bFac, dest.day, dest.period + 1) || plannedFacSlots.has(`${bFacKey}_${dest.day}_${dest.period + 1}`))) continue;
                    if (dest.period === 4 && (hasFacBusy(bFac, dest.day, 5) || plannedFacSlots.has(`${bFacKey}_${dest.day}_5`))) continue;
                    if (dest.period === 5 && (hasFacBusy(bFac, dest.day, 4) || plannedFacSlots.has(`${bFacKey}_${dest.day}_4`))) continue;
                  }

                  pickedDest = dest;
                  usedDests.add(destKey);
                  if (bFacKey) plannedFacSlots.add(`${bFacKey}_${dest.day}_${dest.period}`);
                  break;
                }

                if (!pickedDest) {
                  allBlockersMovable = false;
                  break;
                }
                movePlan.push({ from: b, to: pickedDest, fac: bFac });
              }

              if (!allBlockersMovable) continue;

              // Execute moves
              movePlan.forEach(({ from, to, fac }) => {
                if (fac && fac !== "-") delFacBusy(fac, targetDay, from.period);
                cls.days[to.day][to.idx] = {
                  ...from.slot,
                  period: to.period,
                  time: cls.days[to.day][to.idx]?.time || DEFAULT_TIMINGS[to.period]
                };
                if (fac && fac !== "-") addFacBusy(fac, to.day, to.period);
              });

              // Place unified continuous block
              const isTr = !isPhysicalLab(labAlloc) && (!!labAlloc.isTraining || isTrainingSubject(labAlloc));
              blockEntries.forEach(be => {
                targetDayArr[be.idx] = {
                  period: be.period,
                  time: targetDayArr[be.idx]?.time || DEFAULT_TIMINGS[be.period],
                  subjectCode: labAlloc.subjectCode,
                  subjectName: labAlloc.subjectName,
                  shortName: labAlloc.shortName || labAlloc.subjectCode,
                  facultyName: labFacs.join(", ") || "-",
                  facultyNames: labFacs,
                  type: labAlloc.type || (isTr ? "Training" : "Lab"),
                  difficulty: labAlloc.difficulty || "Normal",
                  isTraining: isTr,
                  room: `${labAlloc.shortName || (labAlloc.type || (isTr ? "Training Hall" : "LAB"))}`
                };
                labFacs.forEach(f => addFacBusy(f, targetDay, be.period));
              });

              isolatedSingles.splice(0, chunk.length);
              consolidated = true;
              modified = true;
              break;
            }
          }
        }

        if (!consolidated) {
          // Restore chunk back to original positions if no clean continuous slot existed
          chunk.forEach(item => {
            cls.days[item.day][item.idx] = item.slot;
            labFacs.forEach(f => addFacBusy(f, item.day, item.period));
          });
          break;
        }
      }
    });
  });

  // --- PASS 1 & 2: MISSING LAB RESCUE + MULTI-TIERED DEFICIT SOLVER ---
  const timings = (schedule.periodTimings && Object.keys(schedule.periodTimings).length > 0)
    ? schedule.periodTimings
    : ((allocDoc?.periodTimings && Object.keys(allocDoc.periodTimings).length > 0) ? allocDoc.periodTimings : DEFAULT_TIMINGS);

  // Deep-clone allocations and sync with SubjectMaster so patterns/hours/difficulty stay up to date
  const syncedAllocs = (allAllocations || []).map(a => (a && a.toObject ? { ...a.toObject() } : { ...a }));
  try {
    const subjectMasters = await SubjectMaster.find({ department: department || schedule.department || "CSE" });
    const curriculumMap = {};
    subjectMasters.forEach(sm => {
      (sm.subjects || []).forEach(s => {
        if (s.code) {
          const codeUp = s.code.toUpperCase();
          curriculumMap[`${sm.year}-${sm.semester}-${codeUp}`] = s;
          curriculumMap[`${sm.year}-${codeUp}`] = s;
          curriculumMap[codeUp] = s;
        }
      });
    });
    syncedAllocs.forEach(a => {
      a.facultyNames = getSlotFacultyList(a);
      const codeKey = a.subjectCode ? String(a.subjectCode).toUpperCase() : "";
      const curr = curriculumMap[`${a.year}-${a.semester}-${codeKey}`] || curriculumMap[`${a.year}-${codeKey}`] || curriculumMap[codeKey];
      if (curr) {
        const chosenPattern = curr.slotPattern || a.slotPattern || "regular";
        a.slotPattern = chosenPattern;
        a.isTraining = chosenPattern !== "regular";
        if (curr.difficulty) a.difficulty = curr.difficulty;
        if (curr.hoursPerWeek !== undefined && curr.hoursPerWeek !== null && curr.hoursPerWeek !== "") {
          a.hoursPerWeek = Number(curr.hoursPerWeek);
        }
      } else {
        a.slotPattern = a.slotPattern || "regular";
        a.isTraining = a.slotPattern !== "regular";
      }
    });
  } catch (syncErr) {
    console.log("Could not sync SubjectMaster during schedule heal:", syncErr.message);
  }

  // Convert schedule.classes into uniform grid[ck][day][p] (`null` for free/empty periods)
  const classGrid = {};
  const classGroups = {};
  const classKeys = [];

  schedule.classes.forEach(cls => {
    const ck = cls.classKey || `${cls.year}-${cls.section || "A"}`;
    classKeys.push(ck);
    classGrid[ck] = {};
    const matchedAllocs = syncedAllocs.filter(a => matchesClassAllocation(a, cls));
    matchedAllocs.forEach(a => {
      const hours = getAllocHours(a);
      const isLab = isLabLikeBlock(a);
      a.parsedPattern = parseSlotPattern(a.slotPattern, hours, a.isTraining, a.type, isLab);
    });
    classGroups[ck] = {
      classKey: ck,
      year: cls.year,
      semester: cls.semester,
      section: cls.section || "A",
      allocations: matchedAllocs
    };

    DAYS.forEach(day => {
      classGrid[ck][day] = {};
      PERIODS.forEach(p => { classGrid[ck][day][p] = null; });
      (cls.days?.[day] || []).forEach((s, idx) => {
        const p = s?.period || (idx + 1);
        if (p >= 1 && p <= 7 && s && !isFreeSlot(s)) {
          classGrid[ck][day][p] = { ...(s.toObject ? s.toObject() : s), period: p };
        }
      });
    });
  });

  if (classKeys.length > 0 && syncedAllocs.length > 0) {
    const facultyMaxWorkloadMap = {};
    syncedAllocs.forEach(a => {
      const h = getAllocHours(a);
      getSlotFacultyList(a).forEach(f => {
        const existingKey = Object.keys(facultyMaxWorkloadMap).find(k => isSameFacultyName(k, f));
        const targetKey = existingKey || f;
        facultyMaxWorkloadMap[targetKey] = (facultyMaxWorkloadMap[targetKey] || 0) + h;
      });
    });

    const solver = createGridSolver({
      classGrid,
      classKeys,
      classGroups,
      facultyMaxWorkloadMap,
      staffMap,
      coordinators: allocDoc?.coordinators,
      timings
    });

    // 1. Recover any completely missing OR partially damaged Lab & Training blocks as contiguous sessions
    solver.repairContinuousAllocations(classKeys);

    // 2. Run the multi-tiered solver (strict -> relaxFatigue -> 2-hop & cross-class liberation -> zero-free)
    solver.runTieredDeficitSolver(classKeys);
  }

  // 3. Flush grid back to schedule.classes (explicit LIB/SEM quota fallback for leftover empty slots)
  schedule.classes.forEach(cls => {
    const ck = cls.classKey || `${cls.year}-${cls.section || "A"}`;
    const clsAllocs = classGroups[ck]?.allocations || [];

    DAYS.forEach(day => {
      const slots = cls.days?.[day] || [];
      PERIODS.forEach((p, idx) => {
        const prevSlot = slots[idx] || slots.find(s => s && s.period === p);
        const origTime = prevSlot?.time || timings[p] || DEFAULT_TIMINGS[p];
        let newSlot = classGrid[ck]?.[day]?.[p] || null;

        if (!newSlot) {
          const libItems = clsAllocs.filter(isLibraryItem);
          const semItems = clsAllocs.filter(isSeminarItem);
          const libItem = libItems[0];
          const semItem = semItems[0];

          const semMax = semItems.reduce((sum, a) => sum + getAllocHours(a), 0);
          const semPlaced = DAYS.reduce((acc, d) => acc + PERIODS.filter(pr => classGrid[ck]?.[d]?.[pr] && isSeminarItem(classGrid[ck][d][pr])).length, 0);
          const libMax = libItems.reduce((sum, a) => sum + getAllocHours(a), 0);
          const libPlaced = DAYS.reduce((acc, d) => acc + PERIODS.filter(pr => classGrid[ck]?.[d]?.[pr] && isLibraryItem(classGrid[ck][d][pr])).length, 0);

          const hasSemToday = PERIODS.some(pr => classGrid[ck]?.[day]?.[pr] && isSeminarItem(classGrid[ck][day][pr]));
          const hasLibToday = PERIODS.some(pr => classGrid[ck]?.[day]?.[pr] && isLibraryItem(classGrid[ck][day][pr]));

          if (p !== 1 && !hasSemToday && semItem && semPlaced < semMax) {
            newSlot = buildOccupiedSlotObject({
              subjectCode: semItem.subjectCode || "SEM",
              subjectName: semItem.subjectName || "Seminar / Technical Presentation",
              shortName: semItem.shortName || "SEM",
              facultyNames: [],
              type: "Seminar",
              difficulty: "Light",
              room: "Seminar Hall"
            }, p, origTime);
            classGrid[ck][day][p] = newSlot;
          } else if (p !== 1 && !hasLibToday && libItem && libPlaced < libMax) {
            newSlot = buildOccupiedSlotObject({
              subjectCode: libItem.subjectCode || "LIB",
              subjectName: libItem.subjectName || "Library / Digital Library",
              shortName: libItem.shortName || "LIB",
              facultyNames: [],
              type: "Library",
              difficulty: "Light",
              room: "Library"
            }, p, origTime);
            classGrid[ck][day][p] = newSlot;
          } else {
            newSlot = makeFreeSlot(p, origTime);
          }
        }

        const prevCode = (prevSlot?.subjectCode || "").toUpperCase();
        const nextCode = (newSlot?.subjectCode || "").toUpperCase();
        const prevFac = (prevSlot?.facultyName || "-").trim();
        const nextFac = (newSlot?.facultyName || "-").trim();

        if (!prevSlot || prevCode !== nextCode || prevFac !== nextFac || prevSlot.type !== newSlot.type) {
          modified = true;
        }
        slots[idx] = { ...newSlot, period: p, time: origTime };
      });
    });
  });

  return modified;
};

// GET saved timetable schedule (automatically heals & fills FREE slots, and prunes any excess hours)
router.get("/schedule", async (req, res) => {
  try {
    const { department = "CSE", academicYear = "2026-2027", semesterType = "Odd" } = req.query;
    let schedule = await TimetableSchedule.findOne({ department, academicYear, semesterType });
    if (schedule && !schedule.isLocked) {
      const sanitized = await sanitizeExcessSubjectHours(schedule, department);
      const healed = await healScheduleFreeSlots(schedule, department);
      if (sanitized || healed) {
        schedule.facultySchedules = await buildFacultySchedules(schedule, department);
        schedule.markModified("classes");
        schedule.markModified("facultySchedules");
        await schedule.save();
      }
    }
    if (!schedule) return res.json(null);

    // Ensure facultySchedules is always populated in response
    let facSchedules = schedule.facultySchedules;
    if (!facSchedules || Object.keys(facSchedules).length === 0) {
      facSchedules = await buildFacultySchedules(schedule, department);
      try {
        schedule.facultySchedules = facSchedules;
        schedule.markModified("facultySchedules");
        await schedule.save();
      } catch (saveErr) {
        console.warn("Could not save facultySchedules to schedule doc:", saveErr.message);
      }
    }

    const scheduleObj = schedule.toObject();
    scheduleObj.facultySchedules = facSchedules;
    res.json(scheduleObj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Explicit Auto-Fill Free Slots Endpoint
router.post("/schedule/fill-free", async (req, res) => {
  try {
    const { department = "CSE", academicYear = "2026-2027", semesterType = "Odd" } = req.body;
    let schedule = await TimetableSchedule.findOne({ department, academicYear, semesterType });
    if (!schedule) return res.status(404).json({ error: "Schedule not found" });

    const sanitized = await sanitizeExcessSubjectHours(schedule, department);
    const healed = await healScheduleFreeSlots(schedule, department);
    if (sanitized || healed || !schedule.facultySchedules || Object.keys(schedule.facultySchedules).length === 0) {
      schedule.facultySchedules = await buildFacultySchedules(schedule, department);
      schedule.markModified("classes");
      schedule.markModified("facultySchedules");
      await schedule.save();
    }
    const scheduleObj = schedule.toObject();
    scheduleObj.facultySchedules = schedule.facultySchedules;
    res.json({ success: true, message: "All periods successfully verified and conflict-free!", schedule: scheduleObj, facultySchedules: schedule.facultySchedules });
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
      const facultySchedules = await buildFacultySchedules(doc, department);
      doc.facultySchedules = facultySchedules;
      doc.markModified("facultySchedules");
      await doc.save();

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
            let targetKey = cleanFac;
            if (!facultySchedules[targetKey]) {
              const matchedKey = Object.keys(facultySchedules).find(k => isSameFacultyName(k, cleanFac));
              if (matchedKey) targetKey = matchedKey;
            }
            if (facultySchedules[targetKey]) {
              const periodIdx = slot.period - 1;
              if (facultySchedules[targetKey].days[d] && facultySchedules[targetKey].days[d][periodIdx]) {
                facultySchedules[targetKey].days[d][periodIdx] = {
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
