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

// Helper: Checks if subject is pure Core Theory (NO lab, project, seminar, library, mentoring, free)
const isPureTheorySubject = (item) => {
  if (!item) return false;
  if (isLibraryItem(item) || isSeminarItem(item) || isLabLikeBlock(item)) return false;
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

    // Normalize faculty key in busy matrix so minor prefix/dot spacing variations always map identically
    const facultyBusy = {};
    const resolveFacKey = (facultyName) => {
      if (!facultyName || facultyName === "-") return "";
      if (facultyBusy[facultyName]) return facultyName;
      const matched = Object.keys(facultyBusy).find(k => isSameFacultyName(k, facultyName));
      return matched || String(facultyName).trim();
    };

    const markFacultyBusy = (facultyName, day, period, classKey) => {
      const key = resolveFacKey(facultyName);
      if (!key) return;
      if (!facultyBusy[key]) facultyBusy[key] = {};
      if (!facultyBusy[key][day]) facultyBusy[key][day] = {};
      facultyBusy[key][day][period] = classKey;
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
      if (!facultyBusy[key] || !facultyBusy[key][day]) return true;
      return !facultyBusy[key][day][period];
    };

    // Total allocated hours per faculty across all allocations (preserves explicit 0)
    const facultyMaxWorkloadMap = {};
    allocations.forEach(a => {
      const h = getAllocHours(a);
      (a.facultyNames || []).forEach(f => {
        if (!f || f === "-") return;
        const existingKey = Object.keys(facultyMaxWorkloadMap).find(k => isSameFacultyName(k, f));
        const targetKey = existingKey || f;
        facultyMaxWorkloadMap[targetKey] = (facultyMaxWorkloadMap[targetKey] || 0) + h;
      });
    });

    const getFacultyTotalScheduledHours = (facName) => {
      if (!facName || facName === "-") return 0;
      let count = 0;
      classKeys.forEach(ck => {
        DAYS.forEach(d => {
          PERIODS.forEach(p => {
            const slot = classGrid[ck]?.[d]?.[p];
            if (slot && slot.facultyNames && slot.facultyNames.some(fn => isSameFacultyName(fn, facName))) {
              count++;
            }
          });
        });
      });
      return count;
    };

    const canFacultyTakeMoreHours = (facName) => {
      if (!facName || facName === "-") return true;
      const matchedKey = Object.keys(facultyMaxWorkloadMap).find(k => isSameFacultyName(k, facName));
      if (!matchedKey) return true;
      return getFacultyTotalScheduledHours(facName) < facultyMaxWorkloadMap[matchedKey];
    };

    const canSubjectTakeMoreHoursInClass = (ck, allocItem) => {
      if (!allocItem) return false;
      const maxNeeded = getAllocHours(allocItem);
      if (maxNeeded <= 0) return false;
      let placed = 0;
      DAYS.forEach(d => {
        PERIODS.forEach(p => {
          const slot = classGrid[ck]?.[d]?.[p];
          if (slot && isSameSubjectSlot(slot, allocItem)) {
            placed++;
          }
        });
      });
      return placed < maxNeeded;
    };

    const checkSeniorAdmin = (facultyName) =>
      isSeniorAdminFaculty(facultyName, staffMap, savedAlloc?.coordinators);

    const getFacultyDailyHours = (facultyName, day) => {
      const key = resolveFacKey(facultyName);
      if (!key || !facultyBusy[key] || !facultyBusy[key][day]) return 0;
      return Object.keys(facultyBusy[key][day]).length;
    };

    const doesFacultyHaveBlockOnDay = (facultyName, day) => {
      const key = resolveFacKey(facultyName);
      if (!key || !facultyBusy[key] || !facultyBusy[key][day]) return false;
      return PERIODS.some(p => {
        const ck = facultyBusy[key][day][p];
        if (!ck) return false;
        const slot = classGrid[ck]?.[day]?.[p];
        return slot && (isLabLikeBlock(slot) || slot.isTraining);
      });
    };

    const doesFacultyHaveLabOnDay = (facultyName, day) => {
      const key = resolveFacKey(facultyName);
      if (!key || !facultyBusy[key] || !facultyBusy[key][day]) return false;
      return PERIODS.some(p => {
        const ck = facultyBusy[key][day][p];
        if (!ck) return false;
        const slot = classGrid[ck]?.[day]?.[p];
        return slot && isPhysicalLab(slot);
      });
    };

    const getClassBlockCountOnDay = (ck, day) => {
      let count = 0;
      PERIODS.forEach(p => {
        const slot = classGrid[ck][day][p];
        if (slot && (isLabLikeBlock(slot) || slot.isTraining)) {
          count++;
        }
      });
      return count;
    };

    const hasLabOnDay = (classKey, day) => {
      return PERIODS.some(p => {
        const slot = classGrid[classKey][day][p];
        return slot && isPhysicalLab(slot);
      });
    };

    const causesFacultyContinuousFatigue = (facultyName, day, p) => {
      if (!facultyName || facultyName === "-") return false;
      if (p <= 2 && checkSeniorAdmin(facultyName)) return true;
      if (p > 1 && !isFacultyFree(facultyName, day, p - 1)) return true;
      if (p < 7 && !isFacultyFree(facultyName, day, p + 1)) return true;
      if (p === 4 && !isFacultyFree(facultyName, day, 5)) return true;
      if (p === 5 && !isFacultyFree(facultyName, day, 4)) return true;

      const dailyHours = getFacultyDailyHours(facultyName, day);
      const hasLabToday = doesFacultyHaveLabOnDay(facultyName, day) || doesFacultyHaveBlockOnDay(facultyName, day);
      const maxDailyCap = hasLabToday ? 4 : 3;
      return dailyHours >= maxDailyCap;
    };

    // Checks faculty constraints for a continuous block.
    // allowSeparatedSameDayBlock = false (Strict Pass): max 1 block/day.
    // allowSeparatedSameDayBlock = true (Fallback Pass): allows morning + afternoon block ONLY with >= 1 free period + lunch gap.
    const wouldCauseFacultyBlockFatigue = (facultyName, day, blockPeriods, allowSeparatedSameDayBlock = false, isLabItem = false) => {
      if (!facultyName || facultyName === "-") return false;
      const key = resolveFacKey(facultyName);
      const minP = Math.min(...blockPeriods);
      const maxP = Math.max(...blockPeriods);

      if (minP <= 2 && checkSeniorAdmin(facultyName)) return true;

      // Adjacent periods immediately before/after the block and direct lunch adjacency are ALWAYS forbidden
      if (minP > 1 && !isFacultyFree(facultyName, day, minP - 1)) return true;
      if (maxP < 7 && !isFacultyFree(facultyName, day, maxP + 1)) return true;
      if (minP === 5 && !isFacultyFree(facultyName, day, 4)) return true;
      if (maxP === 4 && !isFacultyFree(facultyName, day, 5)) return true;

      if (!allowSeparatedSameDayBlock) {
        if (doesFacultyHaveBlockOnDay(facultyName, day)) return true;
        const daily = getFacultyDailyHours(facultyName, day);
        if (daily + blockPeriods.length > 4) return true;
        return false;
      }

      // Relaxed Fallback: Ensure genuine rest gap across lunch between any existing classes on this day & this block
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

      const daily = getFacultyDailyHours(facultyName, day);
      const maxDailyInRelaxed = isLabItem ? 5 : 4;
      return daily + blockPeriods.length > maxDailyInRelaxed;
    };

    const hasAdjacentFacultyHour = (facultyName, day, p) => {
      if (!facultyName) return false;
      const left = p > 1 && !isFacultyFree(facultyName, day, p - 1);
      const right = p < 7 && !isFacultyFree(facultyName, day, p + 1);
      return left || right;
    };

    const getFacultyPeriodCount = (facultyName, p) => {
      const key = resolveFacKey(facultyName);
      if (!key || !facultyBusy[key]) return 0;
      let count = 0;
      DAYS.forEach(d => {
        if (facultyBusy[key][d] && facultyBusy[key][d][p]) count++;
      });
      return count;
    };

    const getSubjectPeriodCount = (ck, subjectCode, p) => {
      let count = 0;
      DAYS.forEach(d => {
        const slot = classGrid[ck][d][p];
        if (slot && slot.subjectCode === subjectCode) count++;
      });
      return count;
    };

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

    const getCandidateBlocksForDuration = (dur, isLab = false) => {
      if (dur >= 4) {
        return [{ name: "Morning (1-4)", periods: [1, 2, 3, 4] }];
      }
      if (dur === 3) {
        return [
          { name: "Afternoon (5-7)", periods: [5, 6, 7] },
          { name: "Morning (2-4)", periods: [2, 3, 4] }
        ];
      }
      if (dur === 2) {
        return isLab
          ? [
              { name: "Afternoon (5-6)", periods: [5, 6] },
              { name: "Afternoon (6-7)", periods: [6, 7] },
              { name: "Morning (3-4)", periods: [3, 4] },
              { name: "Morning (2-3)", periods: [2, 3] }
            ]
          : [
              { name: "Morning (3-4)", periods: [3, 4] },
              { name: "Afternoon (5-6)", periods: [5, 6] },
              { name: "Afternoon (6-7)", periods: [6, 7] },
              { name: "Morning (2-3)", periods: [2, 3] }
            ];
      }
      return [
        { name: "Period 6", periods: [6] },
        { name: "Period 5", periods: [5] },
        { name: "Period 7", periods: [7] }
      ];
    };

    // Parse pattern cleanly; Labs with >= 2h ALWAYS stay in continuous blocks (4h Labs default to [2, 2], never leaving a 1h orphan)
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
      if (cleanPat === "2+1") return { blocks: [2], singles: Math.max(0, total - 2) };
      if (cleanPat === "2+1+1") return { blocks: [2], singles: Math.max(0, total - 2) };
      if (cleanPat === "3+1") return { blocks: [3], singles: Math.max(0, total - 3) };
      if (cleanPat === "4+3") return { blocks: [4, 3], singles: Math.max(0, total - 7) };

      // Custom expression e.g. "2+2+1", "3+2", "1+1+2"
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

      // Standard Labs/Projects without custom split pattern: keep continuous blocks!
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

      // Continuous Training without explicit pattern: 4h defaults to 2+2 alternate days
      if (total >= 7) return { blocks: [4, 3], singles: Math.max(0, total - 7) };
      if (total === 6) return { blocks: [2, 2, 2], singles: 0 };
      if (total === 5) return { blocks: [2, 2], singles: 1 };
      if (total === 4) return { blocks: [2, 2], singles: 0 };
      if (total === 3) return { blocks: [2], singles: 1 };
      if (total === 2) return { blocks: [2], singles: 0 };
      return { blocks: [], singles: total };
    };

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

    // Helper: Count how many periods of allocItem are already placed in classGrid[ck]
    const getPlacedCountInClass = (ck, allocItem) => {
      let count = 0;
      DAYS.forEach(d => {
        PERIODS.forEach(p => {
          const s = classGrid[ck][d][p];
          if (s && isSameSubjectSlot(s, allocItem)) count++;
        });
      });
      return count;
    };

    // Unified Continuous Block Placer (Handles Strict Pass, Relaxed Morning/Afternoon Separation Pass, and Lab Slot-Displacement Swap)
    const placeBlockIntoClass = (ck, item, blockDur, { isLabPhase, relaxedPass = false, allowClassSecondLab = false, allowLabDisplacement = false }) => {
      const facs = item.facultyNames || [];
      const candidateBlocks = getCandidateBlocksForDuration(blockDur, isLabPhase);
      const isPhysical = isPhysicalLab(item);

      const candidateDays = [...DAYS].sort((d1, d2) => {
        // Avoid repeating same subject on the same day
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

      for (const day of candidateDays) {
        if (isPhysical && !allowClassSecondLab && hasLabOnDay(ck, day)) continue;
        if (isPhysical && !relaxedPass && facs.some(f => doesFacultyHaveLabOnDay(f, day))) continue;
        if (PERIODS.some(p => classGrid[ck][day][p] && isSameSubjectSlot(classGrid[ck][day][p], item))) continue;

        const scoredBlocks = candidateBlocks.map(block => {
          let score = 0;
          if (isMathsOrToughSubject(item)) {
            if (block.periods.includes(7)) score += 99999;
            if (block.periods.includes(6)) score += 8000;
          }
          if ((!isPureTheorySubject(item) || isPhysical) && block.periods.includes(1)) {
            score += 99999;
          }
          if (facs.length > 0) {
            facs.forEach(f => {
              block.periods.forEach(p => {
                const pCount = getFacultyPeriodCount(f, p);
                if (pCount >= 2) score += pCount * 4500;
                else if (pCount === 1) score += 1600;
                else score -= 900;
              });
            });
          }
          const isMorning = block.periods.some(p => p <= 4);
          const classMorningBlocks = DAYS.filter(d => classGrid[ck][d] && (classGrid[ck][d][3]?.isTraining || classGrid[ck][d][4]?.isTraining || isPhysicalLab(classGrid[ck][d][3]) || isPhysicalLab(classGrid[ck][d][4]))).length;
          const classAfternoonBlocks = DAYS.filter(d => classGrid[ck][d] && (classGrid[ck][d][5]?.isTraining || classGrid[ck][d][6]?.isTraining || isPhysicalLab(classGrid[ck][d][5]) || isPhysicalLab(classGrid[ck][d][6]))).length;
          if (isMorning && classMorningBlocks > classAfternoonBlocks) score += 1500;
          else if (!isMorning && classAfternoonBlocks > classMorningBlocks) score += 1500;

          const sectionLetter = (classGroups[ck]?.section || "A").toUpperCase();
          if (sectionLetter === "B") score += isMorning ? 500 : -500;
          return { block, score };
        });

        scoredBlocks.sort((a, b) => a.score - b.score);

        for (const { block } of scoredBlocks) {
          if (isMathsOrToughSubject(item) && block.periods.includes(7)) continue;
          if (block.periods.includes(1) && (!isPureTheorySubject(item) || isPhysical)) continue;
          if (block.periods.includes(1) && (classGrid[ck][day][1] !== null || getSubjectPeriodCount(ck, item.subjectCode, 1) >= 1)) continue;

          // First try clean empty block
          const allClassFree = block.periods.every(p => classGrid[ck][day][p] === null);
          const allFacsReady = facs.every(f =>
            block.periods.every(p => isFacultyFree(f, day, p)) &&
            !wouldCauseFacultyBlockFatigue(f, day, block.periods, relaxedPass, isPhysical)
          );

          if (allClassFree && allFacsReady) {
            block.periods.forEach(p => {
              classGrid[ck][day][p] = {
                period: p,
                time: timings[p] || DEFAULT_TIMINGS[p],
                subjectCode: item.subjectCode,
                subjectName: item.subjectName,
                shortName: item.shortName || item.subjectCode,
                facultyName: facs.join(", ") || "-",
                facultyNames: facs,
                type: item.type || (isPhysical ? "Lab" : "Theory"),
                difficulty: item.difficulty || "Normal",
                isTraining: !isPhysical && !!item.isTraining,
                room: isPhysical ? (item.shortName || item.type || "LAB") : (item.isTraining ? "Training Hall / LH-1" : "LH-1")
              };
              facs.forEach(f => markFacultyBusy(f, day, p, ck));
            });
            item.placedBlocksHours = (item.placedBlocksHours || 0) + blockDur;
            item.placedBlockDays = [...(item.placedBlockDays || []), day];
            return true;
          }

          // Optional Pass 3: Displace a single non-pinned blocker slot if it opens up the contiguous block
          if (allowLabDisplacement && allFacsReady) {
            const occupiedInBlock = block.periods.filter(p => classGrid[ck][day][p] !== null);
            const allBlockersSingleNonPinned = occupiedInBlock.every(p => {
              const bSlot = classGrid[ck][day][p];
              return bSlot && !bSlot.isPinned && !isLabLikeBlock(bSlot);
            });
            if (allBlockersSingleNonPinned && occupiedInBlock.length <= 1) {
              const pBlocker = occupiedInBlock[0];
              const blockerSlot = classGrid[ck][day][pBlocker];
              const bFac = (blockerSlot.facultyNames && blockerSlot.facultyNames[0]) || "";
              // Find a valid empty single slot in classGrid[ck] for blockerSlot
              let moved = false;
              for (const destDay of DAYS) {
                if (moved) break;
                for (const destP of PERIODS) {
                  if (destDay === day && block.periods.includes(destP)) continue;
                  if (classGrid[ck][destDay][destP] !== null) continue;
                  if (destP === 1 && !isPureTheorySubject(blockerSlot)) continue;
                  if (destP === 7 && isMathsOrToughSubject(blockerSlot)) continue;
                  if (bFac && (!isFacultyFree(bFac, destDay, destP) || causesFacultyContinuousFatigue(bFac, destDay, destP))) continue;

                  // Relocate blockerSlot cleanly
                  if (bFac) unmarkFacultyBusy(bFac, day, pBlocker);
                  classGrid[ck][destDay][destP] = { ...blockerSlot, period: destP, time: timings[destP] || DEFAULT_TIMINGS[destP] };
                  if (bFac) markFacultyBusy(bFac, destDay, destP, ck);
                  classGrid[ck][day][pBlocker] = null;
                  moved = true;
                  break;
                }
              }
              if (moved) {
                block.periods.forEach(p => {
                  classGrid[ck][day][p] = {
                    period: p,
                    time: timings[p] || DEFAULT_TIMINGS[p],
                    subjectCode: item.subjectCode,
                    subjectName: item.subjectName,
                    shortName: item.shortName || item.subjectCode,
                    facultyName: facs.join(", ") || "-",
                    facultyNames: facs,
                    type: item.type || (isPhysical ? "Lab" : "Theory"),
                    difficulty: item.difficulty || "Normal",
                    isTraining: !isPhysical && !!item.isTraining,
                    room: isPhysical ? (item.shortName || item.type || "LAB") : (item.isTraining ? "Training Hall / LH-1" : "LH-1")
                  };
                  facs.forEach(f => markFacultyBusy(f, day, p, ck));
                });
                item.placedBlocksHours = (item.placedBlocksHours || 0) + blockDur;
                item.placedBlockDays = [...(item.placedBlockDays || []), day];
                return true;
              }
            }
          }
        }
      }
      return false;
    };

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
    wave1LabTasks.forEach(({ ck, item, blockDur }) => {
      let ok = placeBlockIntoClass(ck, item, blockDur, { isLabPhase: true, relaxedPass: false });
      if (!ok) {
        // Retry with morning + afternoon separation across lunch + rest gap
        ok = placeBlockIntoClass(ck, item, blockDur, { isLabPhase: true, relaxedPass: true, allowClassSecondLab: false });
      }
      if (!ok) {
        // Final retry allowing 2nd non-overlapping lab on a day or relocating a single blocking slot so Lab NEVER splits
        ok = placeBlockIntoClass(ck, item, blockDur, { isLabPhase: true, relaxedPass: true, allowClassSecondLab: true, allowLabDisplacement: true });
      }
      if (!ok) {
        unplacedLabs.push({ classKey: ck, subject: item.subjectName, faculty: (item.facultyNames || []).join(", ") });
      }
    });

    // --- WAVE 2: PLACE CONTINUOUS TRAINING / THEORY BLOCKS (e.g. DAA 2+2, WD 2+2, CDS 2+1, CCP-1) ---
    wave2ContinuousTasks.sort((a, b) => b.blockDur - a.blockDur);
    wave2ContinuousTasks.forEach(({ ck, item, blockDur }) => {
      let ok = placeBlockIntoClass(ck, item, blockDur, { isLabPhase: false, relaxedPass: false });
      if (!ok) {
        ok = placeBlockIntoClass(ck, item, blockDur, { isLabPhase: false, relaxedPass: true, allowLabDisplacement: true });
      }
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
        const isLab = isLabLikeBlock(a);
        const totalNeeded = getAllocHours(a);
        if (totalNeeded <= 0) return;

        // NEVER shatter unplaced Lab blocks into single 1-hour periods; only explicit "+1" singles may run in Step B
        if (isLab) {
          const explicitSingles = a.parsedPattern?.singles || 0;
          const blockTargetSum = (a.parsedPattern?.blocks || []).reduce((s, b) => s + b, 0);
          const placedSingles = Math.max(0, getPlacedCountInClass(ck, a) - blockTargetSum);
          const remainingLabSingles = Math.max(0, explicitSingles - placedSingles);
          if (remainingLabSingles > 0) {
            classTheory.push({
              ...(a.toObject ? a.toObject() : a),
              requiredHours: remainingLabSingles,
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

              // 3. If subject is a Physical Lab, enforce max 1 lab per day & no Period 1!
              if (isPhysicalLab(subj)) {
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

              // 🎯 Rule 3: STRICT ZERO CONSECUTIVE / CONTINUOUS HOURS FOR FACULTY
              if (fac && causesFacultyContinuousFatigue(fac, day, p)) {
                return; // Strictly reject: Faculty must have mandatory rest breaks between classes!
              }

              // STRICT: Avoid faculty teaching Period 4 right before an afternoon lab [5, 6, 7]
              if (fac && p === 4 && (!isFacultyFree(fac, day, 5) && !isFacultyFree(fac, day, 6))) {
                return;
              }

              // 🎯 Rule 4: Balance daily faculty load across the week (Distribute teaching evenly)
              if (fac) {
                const dailyHours = getFacultyDailyHours(fac, day);
                if (dailyHours >= 3) {
                  score += 9000;
                } else if (dailyHours === 2) {
                  score += 3500;
                } else if (dailyHours === 1) {
                  score += 800;
                } else if (dailyHours === 0) {
                  score -= 2000; // Strong priority to assign classes on days where faculty currently has 0 hours!
                }
              }

              // Prefer isolated periods with rest/prep breaks for faculty
              if (fac && hasAdjacentFacultyHour(fac, day, p)) {
                score += 50000; // Massive penalty against adjacent hours
              }

              // 🎯 Rule 5: HARD BAN ON SAME THEORY SUBJECT OCCURRING TWICE ON THE SAME DAY!
              const classHoursOfThisSubjToday = PERIODS.filter(pr =>
                classGrid[ck][day][pr] && isSameSubjectSlot(classGrid[ck][day][pr], subj)
              ).length;
              const maxAllowedToday = (isLibraryItem(subj) || isSeminarItem(subj))
                ? 1
                : Math.max(1, Math.ceil((subj.requiredHours || 4) / 5));
              if (classHoursOfThisSubjToday >= maxAllowedToday) {
                return; // Strictly reject: Never allow exceeding max per day in Step B!
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
            
            // 🛑 STRICT QUOTA CHECK: Subject must NOT exceed its hoursPerWeek
            if (!canSubjectTakeMoreHoursInClass(ck, cand)) continue;

            // 🛑 STRICT QUOTA CHECK: Faculty must NOT exceed their allocated workload
            if (fac && !canFacultyTakeMoreHours(fac)) continue;

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
              type: cand.type || "Theory",
              difficulty: cand.difficulty || "Normal",
              room: "LH-1"
            };
            if (fac) markFacultyBusy(fac, day, 1, ck);
            break;
          }
        }
      });
    });

    // --- STEP C: AUTO-FILL REMAINING EMPTY PERIODS (GUARANTEE 100% FULL 35-PERIOD TIMETABLE) ---
    // User Requirement: ZERO "TUT" or dummy subjects! If free, show "Free".
    // AND: If class has remaining unplaced subject hours, ALWAYS place them via direct placement or intelligent swap repair!
    classKeys.forEach(ck => {
      const clsAllocations = classGroups[ck].allocations || [];

      // Helper: All allocation candidates that can take a single hour, sorted by highest deficit first
      const getDeficitCandidates = () => {
        return clsAllocations.filter(a => {
          if (isLabLikeBlock(a) && (a.parsedPattern?.singles || 0) === 0) {
            return false; // NEVER break a Lab block into isolated single 1-hour slots!
          }
          return canSubjectTakeMoreHoursInClass(ck, a);
        }).sort((a, b) => {
          const maxNeededA = getAllocHours(a);
          const maxNeededB = getAllocHours(b);
          const countA = getPlacedCountInClass(ck, a);
          const countB = getPlacedCountInClass(ck, b);
          const defA = Math.max(0, maxNeededA - countA);
          const defB = Math.max(0, maxNeededB - countB);
          if (defA !== defB) return defB - defA;
          const hasFacA = (a.facultyNames && a.facultyNames.length > 0 && a.facultyNames[0] !== "-") ? 1 : 0;
          const hasFacB = (b.facultyNames && b.facultyNames.length > 0 && b.facultyNames[0] !== "-") ? 1 : 0;
          return hasFacB - hasFacA;
        });
      };

      DAYS.forEach(day => {
        PERIODS.forEach(p => {
          if (classGrid[ck][day][p] !== null) return;

          let filled = false;
          const deficitList = getDeficitCandidates();

          // 1. Direct placement of an unplaced deficit subject into (day, p)
          for (const cand of deficitList) {
            const fac = (cand.facultyNames && cand.facultyNames.length > 0) ? cand.facultyNames[0] : "";

            if (!canSubjectTakeMoreHoursInClass(ck, cand)) continue;
            if (fac && !canFacultyTakeMoreHours(fac)) continue;
            if (fac && !isFacultyFree(fac, day, p)) continue;
            if (fac && causesFacultyContinuousFatigue(fac, day, p)) continue;

            if (p === 1) {
              if (!isPureTheorySubject(cand)) continue;
              if (fac && checkSeniorAdmin(fac)) continue;
            }
            if (p === 7 && isMathsOrToughSubject(cand)) continue;

            const leftSlot = p > 1 ? classGrid[ck][day][p - 1] : null;
            const rightSlot = p < 7 ? classGrid[ck][day][p + 1] : null;
            if ((leftSlot && isSameSubjectSlot(leftSlot, cand)) || (rightSlot && isSameSubjectSlot(rightSlot, cand))) {
              continue;
            }

            const timesToday = PERIODS.filter(pr => classGrid[ck][day][pr] && isSameSubjectSlot(classGrid[ck][day][pr], cand)).length;
            const maxToday = (isLibraryItem(cand) || isSeminarItem(cand)) ? 1 : 2;
            if (timesToday >= maxToday) continue;

            classGrid[ck][day][p] = {
              period: p,
              time: timings[p] || DEFAULT_TIMINGS[p],
              subjectCode: cand.subjectCode,
              subjectName: cand.subjectName,
              shortName: cand.shortName || cand.subjectCode,
              facultyName: fac || "-",
              facultyNames: fac ? [fac] : [],
              type: cand.type || "Theory",
              difficulty: cand.difficulty || "Normal",
              room: isLibraryItem(cand) ? "Library" : (isSeminarItem(cand) ? "Seminar Hall" : "LH-1")
            };
            if (fac) markFacultyBusy(fac, day, p, ck);
            filled = true;
            break;
          }

          // 2. SWAP REPAIR: Find another slot in this class to swap with!
          if (!filled) {
            for (const cand of deficitList) {
              if (filled) break;
              if (!canSubjectTakeMoreHoursInClass(ck, cand)) continue;
              const candFac = (cand.facultyNames && cand.facultyNames.length > 0) ? cand.facultyNames[0] : "";
              if (candFac && !canFacultyTakeMoreHours(candFac)) continue;

              for (const donorDay of DAYS) {
                if (filled) break;
                for (const donorP of PERIODS) {
                  if (donorDay === day && donorP === p) continue;
                  const donorSlot = classGrid[ck][donorDay][donorP];
                  if (!donorSlot || donorSlot.isPinned) continue;
                  if (isLabLikeBlock(donorSlot) || donorSlot.isTraining) continue;
                  if (donorSlot.type === "Free" || donorSlot.subjectCode === "FREE") continue;

                  const donorFac = (donorSlot.facultyNames && donorSlot.facultyNames.length > 0) ? donorSlot.facultyNames[0] : (donorSlot.facultyName || "");

                  if (donorFac && donorFac !== "-") unmarkFacultyBusy(donorFac, donorDay, donorP);

                  const donorCanMoveToFreeSlot = (() => {
                    if (donorFac && donorFac !== "-") {
                      if (!isFacultyFree(donorFac, day, p)) return false;
                      if (causesFacultyContinuousFatigue(donorFac, day, p)) return false;
                    }
                    if (p === 1) {
                      if (!isPureTheorySubject(donorSlot)) return false;
                      if (donorFac && checkSeniorAdmin(donorFac)) return false;
                    }
                    if (p === 7 && isMathsOrToughSubject(donorSlot)) return false;
                    const left = p > 1 ? classGrid[ck][day][p - 1] : null;
                    const right = p < 7 ? classGrid[ck][day][p + 1] : null;
                    if ((left && isSameSubjectSlot(left, donorSlot)) || (right && isSameSubjectSlot(right, donorSlot))) return false;
                    const timesOnDay = PERIODS.filter(pr => pr !== p && classGrid[ck][day][pr] && isSameSubjectSlot(classGrid[ck][day][pr], donorSlot)).length;
                    const maxDonorDay = (isLibraryItem(donorSlot) || isSeminarItem(donorSlot)) ? 1 : 2;
                    if (timesOnDay >= maxDonorDay) return false;
                    return true;
                  })();

                  const candCanTakeDonorSlot = (() => {
                    if (!donorCanMoveToFreeSlot) return false;
                    if (candFac && candFac !== "-") {
                      if (!isFacultyFree(candFac, donorDay, donorP)) return false;
                      if (causesFacultyContinuousFatigue(candFac, donorDay, donorP)) return false;
                    }
                    if (donorP === 1) {
                      if (!isPureTheorySubject(cand)) return false;
                      if (candFac && checkSeniorAdmin(candFac)) return false;
                    }
                    if (donorP === 7 && isMathsOrToughSubject(cand)) return false;
                    const left = donorP > 1 ? classGrid[ck][donorDay][donorP - 1] : null;
                    const right = donorP < 7 ? classGrid[ck][donorDay][donorP + 1] : null;
                    if ((left && isSameSubjectSlot(left, cand)) || (right && isSameSubjectSlot(right, cand))) return false;
                    const timesOnDonorDay = PERIODS.filter(pr => pr !== donorP && classGrid[ck][donorDay][pr] && isSameSubjectSlot(classGrid[ck][donorDay][pr], cand)).length;
                    const maxCandDay = (isLibraryItem(cand) || isSeminarItem(cand)) ? 1 : 2;
                    if (timesOnDonorDay >= maxCandDay) return false;
                    return true;
                  })();

                  if (donorCanMoveToFreeSlot && candCanTakeDonorSlot) {
                    classGrid[ck][day][p] = {
                      ...donorSlot,
                      period: p,
                      time: timings[p] || DEFAULT_TIMINGS[p]
                    };
                    if (donorFac && donorFac !== "-") markFacultyBusy(donorFac, day, p, ck);

                    classGrid[ck][donorDay][donorP] = {
                      period: donorP,
                      time: timings[donorP] || DEFAULT_TIMINGS[donorP],
                      subjectCode: cand.subjectCode,
                      subjectName: cand.subjectName,
                      shortName: cand.shortName || cand.subjectCode,
                      facultyName: candFac || "-",
                      facultyNames: candFac ? [candFac] : [],
                      type: cand.type || "Theory",
                      difficulty: cand.difficulty || "Normal",
                      room: isLibraryItem(cand) ? "Library" : (isSeminarItem(cand) ? "Seminar Hall" : "LH-1")
                    };
                    if (candFac && candFac !== "-") markFacultyBusy(candFac, donorDay, donorP, ck);

                    filled = true;
                    break;
                  } else {
                    if (donorFac && donorFac !== "-") markFacultyBusy(donorFac, donorDay, donorP, ck);
                  }
                }
              }
            }
          }

          // 3. Fallback: Only place Library or Seminar if explicitly allocated and under weekly quota!
          if (!filled) {
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
              classGrid[ck][day][p] = {
                period: p,
                time: timings[p] || DEFAULT_TIMINGS[p],
                subjectCode: libItem.subjectCode || "LIB",
                subjectName: libItem.subjectName || "Library / Digital Library",
                shortName: libItem.shortName || "LIB",
                facultyName: "-",
                facultyNames: [],
                type: "Library",
                difficulty: "Light",
                room: "Library"
              };
            } else if (p !== 1 && !hasSemToday && canTakeSem) {
              classGrid[ck][day][p] = {
                period: p,
                time: timings[p] || DEFAULT_TIMINGS[p],
                subjectCode: semItem.subjectCode || "SEM",
                subjectName: semItem.subjectName || "Seminar / Technical Presentation",
                shortName: semItem.shortName || "SEM",
                facultyName: "-",
                facultyNames: [],
                type: "Seminar",
                difficulty: "Light",
                room: "Seminar Hall"
              };
            } else {
              classGrid[ck][day][p] = {
                period: p,
                time: timings[p] || DEFAULT_TIMINGS[p],
                subjectCode: "FREE",
                subjectName: "Free Period",
                shortName: "Free",
                facultyName: "-",
                facultyNames: [],
                type: "Free",
                difficulty: "Normal",
                room: "-"
              };
            }
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

    // Calculate unique Theory count & Lab count per faculty
    allocations.forEach(item => {
      const facs = item.facultyNames || [];
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
                type: slot.type
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

// Helper: Standardized Free Period slot object
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

    // 3. Prune duplicate non-faculty filler/elective slots on the same day
    DAYS.forEach(day => {
      const dayArr = cls.days?.[day] || [];
      const seenElectives = {};
      dayArr.forEach((slot, slotIdx) => {
        if (!slot || slot.type === "Free" || slot.subjectCode === "FREE" || slot.isPinned) return;
        const code = (slot.shortName || slot.subjectCode || "").toUpperCase();
        if (code === "OE" || code === "OPEN ELECTIVE" || ((!slot.facultyName || slot.facultyName === "-") && (slot.type === "Theory" || slot.type === "Elective"))) {
          if (seenElectives[code]) {
            dayArr[slotIdx] = makeFreeSlot(slot.period, slot.time);
            modified = true;
          } else {
            seenElectives[code] = true;
          }
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

  // --- PASS 0: CONSOLIDATE SPLIT LABS (Repair any unlocked Lab scattered across single days back into continuous blocks) ---
  schedule.classes.forEach(cls => {
    const classAllocs = allAllocations.filter(a => matchesClassAllocation(a, cls));
    const labAllocs = classAllocs.filter(a => isLabLikeBlock(a) && getAllocHours(a) >= 2);

    labAllocs.forEach(labAlloc => {
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
          : [[5, 6], [6, 7], [3, 4], [2, 3]];

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
              if (blockers.some(b => b.slot.isPinned || isLabLikeBlock(b.slot) || b.slot.isTraining)) continue;

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

              // Place unified continuous Lab block
              blockEntries.forEach(be => {
                targetDayArr[be.idx] = {
                  period: be.period,
                  time: targetDayArr[be.idx]?.time || DEFAULT_TIMINGS[be.period],
                  subjectCode: labAlloc.subjectCode,
                  subjectName: labAlloc.subjectName,
                  shortName: labAlloc.shortName || labAlloc.subjectCode,
                  facultyName: labFacs.join(", ") || "-",
                  facultyNames: labFacs,
                  type: labAlloc.type || "Lab",
                  difficulty: labAlloc.difficulty || "Normal",
                  room: `${labAlloc.shortName || (labAlloc.type || "LAB")}`
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

  // --- PASS 1: DEFICIT RECOVERY (Recover missing core hours cleanly into Free or replaceable slots) ---
  schedule.classes.forEach(cls => {
    const classAllocs = allAllocations.filter(a => matchesClassAllocation(a, cls));

    const deficitSubjs = [];
    classAllocs.forEach(a => {
      if (isLabLikeBlock(a)) return; // Labs handled via contiguous blocks in Pass 0 / Generate
      const needed = getAllocHours(a);
      if (needed <= 0) return;
      let placed = 0;
      DAYS.forEach(d => {
        (cls.days?.[d] || []).forEach(slotItem => {
          if (slotItem && isSameSubjectSlot(slotItem, a)) placed++;
        });
      });
      if (placed < needed) {
        deficitSubjs.push({ alloc: a, deficit: needed - placed, placed, needed });
      }
    });

    deficitSubjs.sort((x, y) => {
      if (x.deficit !== y.deficit) return y.deficit - x.deficit;
      const hasFacX = (x.alloc.facultyNames && x.alloc.facultyNames.length > 0 && x.alloc.facultyNames[0] !== "-") ? 1 : 0;
      const hasFacY = (y.alloc.facultyNames && y.alloc.facultyNames.length > 0 && y.alloc.facultyNames[0] !== "-") ? 1 : 0;
      return hasFacY - hasFacX;
    });

    deficitSubjs.forEach(defItem => {
      const cand = defItem.alloc;
      const facs = cand.facultyNames || (cand.facultyName ? [cand.facultyName] : []);
      const fac = facs[0] || "";

      const candidateDays = [...DAYS].sort((d1, d2) => {
        const hasD1 = (cls.days?.[d1] || []).some(s => s && isSameSubjectSlot(s, cand)) ? 10 : 0;
        const hasD2 = (cls.days?.[d2] || []).some(s => s && isSameSubjectSlot(s, cand)) ? 10 : 0;
        return hasD1 - hasD2;
      });

      for (const day of candidateDays) {
        if (defItem.deficit <= 0) break;
        const dayArr = cls.days?.[day] || [];

        const timesToday = dayArr.filter(s => s && isSameSubjectSlot(s, cand)).length;
        const maxToday = (isLibraryItem(cand) || isSeminarItem(cand)) ? 1 : 2;
        if (timesToday >= maxToday) continue;

        if (fac && fac !== "-") {
          let facDailyHours = 0;
          PERIODS.forEach(pr => {
            if (hasFacBusy(fac, day, pr)) facDailyHours++;
          });
          const hasLabToday = dayArr.some(s => s && isPhysicalLab(s) && s.facultyNames && s.facultyNames.some(fn => isSameFacultyName(fn, fac)));
          const maxFacCap = hasLabToday ? 4 : 3;
          if (facDailyHours >= maxFacCap) continue;
        }

        for (let pIdx = 0; pIdx < dayArr.length; pIdx++) {
          if (defItem.deficit <= 0) break;
          const s = dayArr[pIdx];
          if (s && s.isPinned) continue;
          const p = s?.period || (pIdx + 1);

          const isFree = !s || s.type === "Free" || s.subjectCode === "FREE" || s.shortName === "FREE";
          let isReplaceableFiller = false;
          if (!isFree && s) {
            const sCode = (s.shortName || s.subjectCode || "").toUpperCase();
            if (sCode === "OE" || sCode === "OPEN ELECTIVE" || ((!s.facultyName || s.facultyName === "-") && (s.type === "Theory" || s.type === "Elective"))) {
              const oeToday = dayArr.filter(x => (x.shortName || x.subjectCode || "").toUpperCase() === "OE").length;
              if (oeToday > 1) isReplaceableFiller = true;
              else {
                let totalOe = 0;
                DAYS.forEach(d => {
                  (cls.days?.[d] || []).forEach(x => {
                    if ((x.shortName || x.subjectCode || "").toUpperCase() === "OE") totalOe++;
                  });
                });
                if (totalOe > 3) isReplaceableFiller = true;
              }
            } else if (isLibraryItem(s) || isSeminarItem(s) || s.type === "Mentoring" || sCode === "MENTOR") {
              const sameTypeToday = dayArr.filter(x => x.type === s.type || x.shortName === sCode).length;
              if (sameTypeToday > 1) isReplaceableFiller = true;
            }
          }

          if (!isFree && !isReplaceableFiller) continue;

          // Enforce Period 1 pure core theory only rule in Pass 1 Direct too!
          if (p === 1 && !isPureTheorySubject(cand)) continue;

          if (fac && fac !== "-") {
            if (p <= 2 && isSeniorAdminFaculty(fac, staffMap)) continue;
            if (hasFacBusy(fac, day, p)) continue;
            if (p > 1 && hasFacBusy(fac, day, p - 1)) continue;
            if (p < 7 && hasFacBusy(fac, day, p + 1)) continue;
            if (p === 4 && hasFacBusy(fac, day, 5)) continue;
            if (p === 5 && hasFacBusy(fac, day, 4)) continue;
          }

          const left = dayArr.find(x => x.period === p - 1);
          const right = dayArr.find(x => x.period === p + 1);
          if ((left && isSameSubjectSlot(left, cand)) || (right && isSameSubjectSlot(right, cand))) {
            continue;
          }

          if (p === 7 && isMathsOrToughSubject(cand)) continue;

          if (s && s.facultyNames) {
            s.facultyNames.forEach(fn => delFacBusy(fn, day, p));
          }

          dayArr[pIdx] = {
            period: p,
            time: s?.time || DEFAULT_TIMINGS[p],
            subjectCode: cand.subjectCode || cand.code,
            subjectName: cand.subjectName || cand.name,
            shortName: cand.shortName || cand.subjectCode || cand.code,
            facultyName: fac || "-",
            facultyNames: fac ? [fac] : [],
            type: cand.type || "Theory",
            difficulty: cand.difficulty || "Normal",
            room: isLibraryItem(cand) ? "Library" : (isSeminarItem(cand) ? "Seminar Hall" : "LH-1")
          };

          if (fac && fac !== "-") addFacBusy(fac, day, p);
          defItem.deficit--;
          modified = true;
          break;
        }
      }

      // SWAP REPAIR: Recover remaining deficit when direct slots had constraints
      if (defItem.deficit > 0) {
        for (const targetDay of DAYS) {
          if (defItem.deficit <= 0) break;
          const targetDayArr = cls.days?.[targetDay] || [];

          for (let tpIdx = 0; tpIdx < targetDayArr.length; tpIdx++) {
            if (defItem.deficit <= 0) break;
            const targetSlot = targetDayArr[tpIdx];
            if (targetSlot && targetSlot.isPinned) continue;
            const targetP = targetSlot?.period || (tpIdx + 1);

            const isFree = !targetSlot || targetSlot.type === "Free" || targetSlot.subjectCode === "FREE" || targetSlot.shortName === "FREE";
            let isReplaceable = false;
            if (!isFree && targetSlot) {
              const sc = (targetSlot.shortName || targetSlot.subjectCode || "").toUpperCase();
              if (sc === "OE") isReplaceable = true;
            }
            if (!isFree && !isReplaceable) continue;

            for (const donorDay of DAYS) {
              if (defItem.deficit <= 0) break;
              const donorDayArr = cls.days?.[donorDay] || [];

              for (let dpIdx = 0; dpIdx < donorDayArr.length; dpIdx++) {
                if (donorDay === targetDay && dpIdx === tpIdx) continue;
                const donorSlot = donorDayArr[dpIdx];
                if (!donorSlot || donorSlot.isPinned) continue;
                if (donorSlot.isTraining || isLabLikeBlock(donorSlot)) continue;
                if (donorSlot.type === "Free" || donorSlot.subjectCode === "FREE") continue;
                if (isSameSubjectSlot(donorSlot, cand)) continue;

                const donorP = donorSlot.period || (dpIdx + 1);
                const donorFacs = donorSlot.facultyNames || (donorSlot.facultyName ? [donorSlot.facultyName] : []);
                const donorFac = donorFacs[0] || "";

                if (donorFac && donorFac !== "-") delFacBusy(donorFac, donorDay, donorP);

                const donorCanMove = (() => {
                  if (donorFac && donorFac !== "-") {
                    if (targetP <= 2 && isSeniorAdminFaculty(donorFac, staffMap)) return false;
                    if (hasFacBusy(donorFac, targetDay, targetP)) return false;
                    if (targetP > 1 && hasFacBusy(donorFac, targetDay, targetP - 1)) return false;
                    if (targetP < 7 && hasFacBusy(donorFac, targetDay, targetP + 1)) return false;
                    if (targetP === 4 && hasFacBusy(donorFac, targetDay, 5)) return false;
                    if (targetP === 5 && hasFacBusy(donorFac, targetDay, 4)) return false;
                  }
                  if (targetP === 1 && !isPureTheorySubject(donorSlot)) return false;
                  if (targetP === 7 && isMathsOrToughSubject(donorSlot)) return false;
                  const left = targetDayArr.find(x => x.period === targetP - 1);
                  const right = targetDayArr.find(x => x.period === targetP + 1);
                  if ((left && isSameSubjectSlot(left, donorSlot)) || (right && isSameSubjectSlot(right, donorSlot))) return false;
                  const timesOnTarget = targetDayArr.filter(x => x.period !== targetP && isSameSubjectSlot(x, donorSlot)).length;
                  if (timesOnTarget >= ((isLibraryItem(donorSlot) || isSeminarItem(donorSlot)) ? 1 : 2)) return false;
                  return true;
                })();

                const candCanTake = (() => {
                  if (!donorCanMove) return false;
                  if (fac && fac !== "-") {
                    if (donorP <= 2 && isSeniorAdminFaculty(fac, staffMap)) return false;
                    if (hasFacBusy(fac, donorDay, donorP)) return false;
                    if (donorP > 1 && hasFacBusy(fac, donorDay, donorP - 1)) return false;
                    if (donorP < 7 && hasFacBusy(fac, donorDay, donorP + 1)) return false;
                    if (donorP === 4 && hasFacBusy(fac, donorDay, 5)) return false;
                    if (donorP === 5 && hasFacBusy(fac, donorDay, 4)) return false;
                  }
                  if (donorP === 1 && !isPureTheorySubject(cand)) return false;
                  if (donorP === 7 && isMathsOrToughSubject(cand)) return false;
                  const left = donorDayArr.find(x => x.period === donorP - 1);
                  const right = donorDayArr.find(x => x.period === donorP + 1);
                  if ((left && isSameSubjectSlot(left, cand)) || (right && isSameSubjectSlot(right, cand))) return false;
                  const timesOnDonor = donorDayArr.filter(x => x.period !== donorP && isSameSubjectSlot(x, cand)).length;
                  if (timesOnDonor >= ((isLibraryItem(cand) || isSeminarItem(cand)) ? 1 : 2)) return false;
                  return true;
                })();

                if (donorCanMove && candCanTake) {
                  targetDayArr[tpIdx] = {
                    ...donorSlot,
                    period: targetP,
                    time: targetSlot?.time || DEFAULT_TIMINGS[targetP]
                  };
                  if (donorFac && donorFac !== "-") addFacBusy(donorFac, targetDay, targetP);

                  donorDayArr[dpIdx] = {
                    period: donorP,
                    time: donorSlot?.time || DEFAULT_TIMINGS[donorP],
                    subjectCode: cand.subjectCode || cand.code,
                    subjectName: cand.subjectName || cand.name,
                    shortName: cand.shortName || cand.subjectCode || cand.code,
                    facultyName: fac || "-",
                    facultyNames: fac ? [fac] : [],
                    type: cand.type || "Theory",
                    difficulty: cand.difficulty || "Normal",
                    room: isLibraryItem(cand) ? "Library" : (isSeminarItem(cand) ? "Seminar Hall" : "LH-1")
                  };
                  if (fac && fac !== "-") addFacBusy(fac, donorDay, donorP);

                  defItem.deficit--;
                  modified = true;
                  break;
                } else {
                  if (donorFac && donorFac !== "-") addFacBusy(donorFac, donorDay, donorP);
                }
              }
            }
          }
        }
      }
    });
  });

  // --- PASS 2: AUTO-FILL ANY REMAINING FREE SLOTS ---
  schedule.classes.forEach(cls => {
    const classAllocs = allAllocations.filter(a => matchesClassAllocation(a, cls));

    const existingSubjs = [];
    DAYS.forEach(d => {
      (cls.days?.[d] || []).forEach(s => {
        if (s && s.subjectCode && s.subjectCode !== "FREE" && s.type !== "Free") {
          if (!existingSubjs.some(x => x.subjectCode === s.subjectCode)) {
            existingSubjs.push(s);
          }
        }
      });
    });

    const candidatePool = classAllocs.length > 0 ? classAllocs : existingSubjs;

    DAYS.forEach(day => {
      const slots = cls.days?.[day] || [];
      slots.forEach((s, idx) => {
        if (!s || s.type === "Free" || s.subjectCode === "FREE" || s.shortName === "FREE") {
          const p = s?.period || (idx + 1);
          let chosen = null;

          // 1. Try finding a non-lab Theory/Elective candidate under weekly quota
          for (const cand of candidatePool) {
            if (isLabLikeBlock(cand)) continue;
            if (p === 1 && !isPureTheorySubject(cand)) continue;

            const maxNeeded = getAllocHours(cand);
            if (maxNeeded <= 0) continue;

            let placedInClass = 0;
            DAYS.forEach(d => {
              (cls.days?.[d] || []).forEach(slotItem => {
                if (slotItem && isSameSubjectSlot(slotItem, cand)) placedInClass++;
              });
            });
            if (placedInClass >= maxNeeded) continue;

            const timesToday = slots.filter(x => x && isSameSubjectSlot(x, cand)).length;
            if (timesToday >= ((isLibraryItem(cand) || isSeminarItem(cand)) ? 1 : 2)) continue;

            const facs = cand.facultyNames || (cand.facultyName ? [cand.facultyName] : []);
            const fac = facs[0] || "";

            if (fac && fac !== "-") {
              const facAllocTotal = allAllocations.reduce((acc, a) => {
                if (a.facultyNames && a.facultyNames.some(fn => isSameFacultyName(fn, fac))) {
                  return acc + getAllocHours(a);
                }
                return acc;
              }, 0);

              let facCurrentHours = 0;
              schedule.classes.forEach(cItem => {
                DAYS.forEach(d => {
                  (cItem.days?.[d] || []).forEach(slotItem => {
                    if (slotItem && slotItem.facultyNames && slotItem.facultyNames.some(fn => isSameFacultyName(fn, fac))) {
                      facCurrentHours++;
                    }
                  });
                });
              });

              if (facAllocTotal > 0 && facCurrentHours >= facAllocTotal) continue;

              if (hasFacBusy(fac, day, p)) continue;
              if (p <= 2 && isSeniorAdminFaculty(fac, staffMap)) continue;
              if (p > 1 && hasFacBusy(fac, day, p - 1)) continue;
              if (p < 7 && hasFacBusy(fac, day, p + 1)) continue;
              if (p === 4 && hasFacBusy(fac, day, 5)) continue;
              if (p === 5 && hasFacBusy(fac, day, 4)) continue;
            }

            const left = slots.find(x => x.period === p - 1);
            const right = slots.find(x => x.period === p + 1);
            if ((left && isSameSubjectSlot(left, cand)) || (right && isSameSubjectSlot(right, cand))) continue;
            if (p === 7 && isMathsOrToughSubject(cand)) continue;

            chosen = {
              period: p,
              time: s?.time || DEFAULT_TIMINGS[p],
              subjectCode: cand.subjectCode || cand.code,
              subjectName: cand.subjectName || cand.name,
              shortName: cand.shortName || cand.subjectCode || cand.code,
              facultyName: fac || "-",
              facultyNames: fac ? [fac] : [],
              type: cand.type || "Theory",
              difficulty: cand.difficulty || "Normal",
              room: isLibraryItem(cand) ? "Library" : (isSeminarItem(cand) ? "Seminar Hall" : "LH-1")
            };
            if (fac && fac !== "-") addFacBusy(fac, day, p);
            break;
          }

          // 2. Fallback to Seminar or Library ONLY IF explicitly allocated and under weekly quota
          if (!chosen) {
            const semItems = classAllocs.filter(isSeminarItem);
            const libItems = classAllocs.filter(isLibraryItem);
            const semItem = semItems[0];
            const libItem = libItems[0];

            const semMaxAllowed = semItems.reduce((sum, a) => sum + getAllocHours(a), 0);
            const libMaxAllowed = libItems.reduce((sum, a) => sum + getAllocHours(a), 0);

            const semPlacedTotal = DAYS.reduce((acc, d) => acc + (cls.days?.[d] || []).filter(x => x && x.type !== "Free" && isSeminarItem(x)).length, 0);
            const libPlacedTotal = DAYS.reduce((acc, d) => acc + (cls.days?.[d] || []).filter(x => x && x.type !== "Free" && isLibraryItem(x)).length, 0);

            const hasSemToday = slots.some(x => x && x.type !== "Free" && isSeminarItem(x));
            const hasLibToday = slots.some(x => x && x.type !== "Free" && isLibraryItem(x));

            if (p !== 1 && !hasSemToday && semItem && semPlacedTotal < semMaxAllowed) {
              chosen = {
                period: p,
                time: s?.time || DEFAULT_TIMINGS[p],
                subjectCode: semItem.subjectCode || "SEM",
                subjectName: semItem.subjectName || "Seminar / Technical Presentation",
                shortName: semItem.shortName || "SEM",
                facultyName: "-",
                facultyNames: [],
                type: "Seminar",
                difficulty: "Light",
                room: "Seminar Hall"
              };
            } else if (p !== 1 && !hasLibToday && libItem && libPlacedTotal < libMaxAllowed) {
              chosen = {
                period: p,
                time: s?.time || DEFAULT_TIMINGS[p],
                subjectCode: libItem.subjectCode || "LIB",
                subjectName: libItem.subjectName || "Library / Digital Library",
                shortName: libItem.shortName || "LIB",
                facultyName: "-",
                facultyNames: [],
                type: "Library",
                difficulty: "Light",
                room: "Library"
              };
            } else {
              chosen = makeFreeSlot(p, s?.time);
            }
          }

          slots[idx] = chosen;
          modified = true;
        }
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
