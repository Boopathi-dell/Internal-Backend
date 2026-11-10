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

// Helper: How many periods on 'day' are already taken by block sessions (Lab, Project, Training)
const isBlockType = (type) => {
  const t = (type || "").toLowerCase();
  return t.includes("lab") || t.includes("project");
};

// Helper: Checks if subject is a physical laboratory (e.g. Computer/Hardware lab).
// Placement, Aptitude, Career Development Skills (CDS), and Training are classroom-based and NOT physical labs.
const isPhysicalLab = (item) => {
  if (!item) return false;
  const s = `${item.subjectCode || ""} ${item.subjectName || ""} ${item.shortName || ""} ${item.type || ""}`.toLowerCase();
  if (s.includes("cds") || s.includes("aptitude") || s.includes("career") || s.includes("placement") || 
      s.includes("soft skill") || s.includes("trainer") || s.includes("training") || s.includes("counsel") || s.includes("mentor")) {
    return false;
  }
  return isBlockType(item.type);
};

// Universal helper to check if a schedule slot matches an allocation item accurately
const isSameSubjectSlot = (slot, allocItem) => {
  if (!slot || slot.type === "Free" || slot.subjectCode === "FREE") return false;
  if (!allocItem) return false;

  const allocCode = (allocItem.subjectCode || allocItem.code || "").trim().toUpperCase();
  const slotCode = (slot.subjectCode || "").trim().toUpperCase();

  // 1. If subject codes match exactly, it is definitively the same subject!
  if (allocCode && slotCode && allocCode === slotCode) {
    return true;
  }

  // 2. If matching by shortName / abbreviation:
  // MUST strictly match course type (Laboratory vs Theory)!
  // Theory must NEVER match a Lab slot, and Lab must NEVER match a Theory slot!
  const allocShort = (allocItem.shortName || "").trim().toUpperCase();
  const slotShort = (slot.shortName || "").trim().toUpperCase();
  if (allocShort && slotShort && allocShort === slotShort) {
    const isAllocLab = (allocItem.type || "").toLowerCase().includes("lab") || isBlockType(allocItem.type);
    const isSlotLab = (slot.type || "").toLowerCase().includes("lab") || isBlockType(slot.type);
    if (isAllocLab === isSlotLab) {
      return true;
    }
  }

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
const isSeniorAdminFaculty = (facultyName, staffMap = {}) => {
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

    const unmarkFacultyBusy = (facultyName, day, period) => {
      if (!facultyName) return;
      if (facultyBusy[facultyName]?.[day]) {
        delete facultyBusy[facultyName][day][period];
      }
    };

    const isFacultyFree = (facultyName, day, period) => {
      if (!facultyName) return true;
      if (!facultyBusy[facultyName]) return true;
      if (!facultyBusy[facultyName][day]) return true;
      return !facultyBusy[facultyName][day][period];
    };

    // Helper: Count how many times a subject has been placed in classGrid[ck]
    const getSubjectPlacedCountInClass = (ck, subjectCode) => {
      let count = 0;
      DAYS.forEach(d => {
        PERIODS.forEach(p => {
          if (classGrid[ck]?.[d]?.[p]?.subjectCode === subjectCode) {
            count++;
          }
        });
      });
      return count;
    };

    // Helper: Total allocated hours per faculty across all allocations
    const facultyMaxWorkloadMap = {};
    allocations.forEach(a => {
      const h = Number(a.hoursPerWeek) || 0;
      (a.facultyNames || []).forEach(f => {
        if (!f || f === "-") return;
        const existingKey = Object.keys(facultyMaxWorkloadMap).find(k => isSameFacultyName(k, f));
        const targetKey = existingKey || f;
        facultyMaxWorkloadMap[targetKey] = (facultyMaxWorkloadMap[targetKey] || 0) + h;
      });
    });

    // Helper: Count total scheduled teaching hours for a faculty across all classes
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

    // Helper: Check if faculty can take more teaching hours (cannot exceed allocated hours!)
    const canFacultyTakeMoreHours = (facName) => {
      if (!facName || facName === "-") return true;
      const matchedKey = Object.keys(facultyMaxWorkloadMap).find(k => isSameFacultyName(k, facName));
      if (!matchedKey) return true;
      const maxAllowed = facultyMaxWorkloadMap[matchedKey];
      const scheduled = getFacultyTotalScheduledHours(facName);
      return scheduled < maxAllowed;
    };

    // Helper: Check if a subject can take more hours in a class (cannot exceed hoursPerWeek!)
    const canSubjectTakeMoreHoursInClass = (ck, allocItem) => {
      if (!allocItem) return false;
      const maxNeeded = Number(allocItem.hoursPerWeek) || 4;
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

    // Helper: Checks if faculty is a Senior Administrative Leader (HOD, Asst HOD, ASP / Associate Professor)
    // USER RULE 5: HOD, ASST HOD, and ASP MUST NEVER have classes in Period 1 or Period 2!
    // (Morning periods 1 & 2 are strictly reserved for administrative duties, meetings, attendance, etc.)
    const isSeniorAdminFaculty = (facultyName) => {
      if (!facultyName || facultyName === "-") return false;
      const clean = String(facultyName).trim().toLowerCase();

      // Check string keywords in facultyName
      if (clean.includes("hod") || clean.includes("head") || clean.includes("asp") || clean.includes("assoc")) {
        return true;
      }

      // Check Staff database record designation
      const matchedKey = Object.keys(staffMap).find(k => isSameFacultyName(k, clean));
      if (matchedKey && staffMap[matchedKey]) {
        const desig = (staffMap[matchedKey].designation || "").toLowerCase();
        if (desig.includes("head") || desig.includes("hod") || desig.includes("assoc") || desig.includes("asp")) {
          return true;
        }
      }

      // Check Coordinator data
      if (savedAlloc?.coordinators) {
        const hodStr = (savedAlloc.coordinators.hod || "").toLowerCase();
        if (hodStr && isSameFacultyName(clean, hodStr)) return true;
      }

      return false;
    };

    // Helper: Daily teaching hours for faculty on day
    const getFacultyDailyHours = (facultyName, day) => {
      if (!facultyName || !facultyBusy[facultyName] || !facultyBusy[facultyName][day]) return 0;
      return Object.keys(facultyBusy[facultyName][day]).length;
    };

    // Helper: Checks if faculty already has any multi-period block (>= 2 hours) on 'day' across any class
    const doesFacultyHaveBlockOnDay = (facultyName, day) => {
      if (!facultyName || !facultyBusy[facultyName] || !facultyBusy[facultyName][day]) return false;
      return PERIODS.some(p => {
        const ck = facultyBusy[facultyName][day][p];
        if (!ck) return false;
        const slot = classGrid[ck]?.[day]?.[p];
        return slot && (isBlockType(slot.type) || slot.isTraining);
      });
    };

    // Helper: Checks if placing (facultyName, day, p) causes consecutive / continuous teaching for that faculty
    // STRICT USER REQUIREMENT: Faculty must NEVER have back-to-back continuous hours!
    // They must have mandatory rest / preparation breaks between every class.
    const causesFacultyContinuousFatigue = (facultyName, day, p) => {
      if (!facultyName || facultyName === "-") return false;

      // 0. HARD BAN: HOD, ASST HOD, and ASP MUST NEVER have classes in Period 1 or Period 2!
      if (p <= 2 && isSeniorAdminFaculty(facultyName)) {
        return true; // Strictly reject: Morning periods 1 & 2 reserved for administrative duties
      }

      // 1. Immediate predecessor check: Is faculty already teaching Period p - 1?
      // (Even across lunch break between P4 and P5, avoid back-to-back teaching without proper rest)
      if (p > 1 && !isFacultyFree(facultyName, day, p - 1)) {
        return true; // Strict consecutive ban: e.g. P1->P2, P2->P3, P3->P4, P4->P5, P5->P6, P6->P7
      }

      // 2. Immediate successor check: Is faculty already teaching Period p + 1?
      if (p < 7 && !isFacultyFree(facultyName, day, p + 1)) {
        return true; // Strict consecutive ban: e.g. P1<-P2, P2<-P3, P3<-P4, P4<-P5, P5<-P6, P6<-P7
      }

      // Also prevent teaching Period 4 immediately into Period 5 (lunch break boundary)
      if (p === 4 && !isFacultyFree(facultyName, day, 5)) return true;
      if (p === 5 && !isFacultyFree(facultyName, day, 4)) return true;

      // 3. Daily workload cap: Max 3 hours of theory per day (or max 4 only if conducting lab)
      const dailyHours = getFacultyDailyHours(facultyName, day);
      const hasLabToday = doesFacultyHaveLabOnDay(facultyName, day) || doesFacultyHaveBlockOnDay(facultyName, day);
      const maxDailyCap = hasLabToday ? 4 : 3;
      if (dailyHours >= maxDailyCap) {
        return true; // Avoid overloading faculty on 1 day when other days of the week are available
      }

      return false;
    };

    // Helper: Checks if placing a multi-period continuous block causes consecutive hours or excessive load for that faculty
    const wouldCauseFacultyBlockFatigue = (facultyName, day, blockPeriods) => {
      if (!facultyName || facultyName === "-") return false;
      const minP = Math.min(...blockPeriods);
      const maxP = Math.max(...blockPeriods);

      // 0. HARD BAN: HOD, ASST HOD, and ASP MUST NEVER have block sessions starting or running in Period 1 or 2!
      if (minP <= 2 && isSeniorAdminFaculty(facultyName)) {
        return true;
      }

      // 1. HARD BAN: Faculty can NEVER have more than 1 block session on the same day!
      // (Stops faculty from teaching a lab in the morning AND another 2-hour block in the afternoon!)
      if (doesFacultyHaveBlockOnDay(facultyName, day)) {
        return true;
      }

      // 2. HARD BAN: Faculty CANNOT teach adjacent period immediately before or after the block!
      if (minP > 1 && !isFacultyFree(facultyName, day, minP - 1)) {
        return true; // e.g. If block is [3, 4], Period 2 must NOT be taught by this faculty!
      }
      if (maxP < 7 && !isFacultyFree(facultyName, day, maxP + 1)) {
        return true; // e.g. If block is [3, 4], Period 5 must NOT be taught by this faculty!
      }

      // Across lunch break:
      if (minP === 5 && !isFacultyFree(facultyName, day, 4)) {
        return true; // If block is [5, 6], Period 4 must be free so faculty can rest during lunch!
      }
      if (maxP === 4 && !isFacultyFree(facultyName, day, 5)) {
        return true; // If block is [3, 4], Period 5 must be free!
      }

      // 3. Daily fatigue check: Total daily hours including this block must not exceed 4 hours!
      const daily = getFacultyDailyHours(facultyName, day);
      if (daily + blockPeriods.length > 4) {
        return true;
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
    const isBlockType = (type) => {
      const t = (type || "").toLowerCase();
      return t.includes("lab") || t.includes("project");
    };

    // Helper: Checks if subject is a physical laboratory (e.g. Computer/Hardware lab).
    // Placement, Aptitude, Career Development Skills (CDS), and Training are classroom-based and NOT physical labs.
    const isPhysicalLab = (item) => {
      if (!item) return false;
      const s = `${item.subjectCode || ""} ${item.subjectName || ""} ${item.shortName || ""} ${item.type || ""}`.toLowerCase();
      if (s.includes("cds") || s.includes("aptitude") || s.includes("career") || s.includes("placement") || 
          s.includes("soft skill") || s.includes("trainer") || s.includes("training") || s.includes("counsel") || s.includes("mentor")) {
        return false;
      }
      return isBlockType(item.type);
    };

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
        return slot && isPhysicalLab(slot);
      });
    };

    // Helper: Checks if faculty already conducts any Lab / Laboratory on a given day across any class (Enforces MAX 1 LAB PER FACULTY PER DAY)
    const doesFacultyHaveLabOnDay = (facultyName, day) => {
      if (!facultyName || !facultyBusy[facultyName] || !facultyBusy[facultyName][day]) return false;
      return PERIODS.some(p => {
        const ck = facultyBusy[facultyName][day][p];
        if (!ck) return false;
        const slot = classGrid[ck] && classGrid[ck][day] && classGrid[ck][day][p];
        return slot && isPhysicalLab(slot);
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
      return /math|algebra|calculus|discrete|probability|statistics|numerical|pbs|nm|dm|flat|toc|automata|compiler|pas|daa|p&s|ps|maths/i.test(str);
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

    // --- STEP 0.0: PRE-LOCKED / PINNED INSTITUTIONAL SLOTS (Option 1: Fixed Slots & Option 3: Grid Pinning) ---
    // User Requirement:
    // Support Fixed Institutional Slots (Library, Placement Hall, Seminar, or pinned manual edits).
    // If NO slots are fixed/pinned, this step is automatically bypassed and standard auto-generation runs!

    // 1. Process Pinned Slots from existing schedule (Option 3: Grid Pinning)
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

              // Track placed hour on matching allocation so it does not duplicate
              const matchAlloc = classGroups[ck]?.allocations?.find(a => isSameSubjectSlot(oldSlot, a));
              if (matchAlloc) {
                matchAlloc.placedBlocksHours = (matchAlloc.placedBlocksHours || 0) + 1;
              }
            }
          });
        });
      });
    }

    // 2. Process Fixed Slots from Allocations (Option 1: Workload Allocation Fixed Day & Period)
    classKeys.forEach(ck => {
      const clsAllocations = classGroups[ck].allocations || [];
      clsAllocations.forEach(alloc => {
        const slotsToFix = Array.isArray(alloc.fixedSlots) ? alloc.fixedSlots : [];
        slotsToFix.forEach(fix => {
          const day = fix.day;
          const p = Number(fix.period);
          if (DAYS.includes(day) && p >= 1 && p <= 7) {
            // Place if slot is not already taken
            if (classGrid[ck][day][p] === null) {
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
                room: alloc.room || (alloc.type === "Library" ? "Library" : (alloc.type === "Lab" ? "Lab" : "LH-1")),
                isPinned: true
              };
              facs.forEach(f => {
                if (f && f !== "-") markFacultyBusy(f, day, p, ck);
              });
              alloc.placedBlocksHours = (alloc.placedBlocksHours || 0) + 1;
            }
          }
        });
      });
    });

    // --- STEP 0: CLASS ADVISOR SUBJECT ON MONDAY PERIOD 1 ---
    // User Requirement:
    // Monday first hour is NOT a dummy advisor hour.
    // If the advisor teaches a pure Core Theory subject in this class, schedule that real subject on Monday Period 1.
    // If the advisor does NOT teach a pure Theory subject in this class, do not insert any dummy hour!
    classKeys.forEach(ck => {
      const advisor = classAdvisors && classAdvisors[ck];
      if (!advisor) return;

      if (!isFacultyFree(advisor, "Monday", 1) || isSeniorAdminFaculty(advisor)) {
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

            // If item is a Physical Lab, enforce MAX 1 LAB PER CLASS & PER FACULTY PER DAY!
            if (isPhysicalLab(item)) {
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
              const maxAllowedToday = Math.max(1, Math.ceil((subj.requiredHours || 4) / 5));
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
          if (isBlockType(a.type) && a.slotPattern !== "regular" && (Number(a.hoursPerWeek) || 0) > 1) {
            return false; // Leave multi-period monolithic lab blocks to Step 2
          }
          return canSubjectTakeMoreHoursInClass(ck, a);
        }).sort((a, b) => {
          const maxNeededA = Number(a.hoursPerWeek) || 4;
          const maxNeededB = Number(b.hoursPerWeek) || 4;
          let countA = 0;
          let countB = 0;
          DAYS.forEach(d => {
            PERIODS.forEach(pr => {
              if (classGrid[ck]?.[d]?.[pr] && isSameSubjectSlot(classGrid[ck][d][pr], a)) countA++;
              if (classGrid[ck]?.[d]?.[pr] && isSameSubjectSlot(classGrid[ck][d][pr], b)) countB++;
            });
          });
          const defA = Math.max(0, maxNeededA - countA);
          const defB = Math.max(0, maxNeededB - countB);
          if (defA !== defB) return defB - defA; // Highest deficit first!
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

            // Period 1 constraints: Pure theory only, NO HOD/ASP, NO Library/Seminar
            if (p === 1) {
              if (!isPureTheorySubject(cand)) continue;
              if (fac && isSeniorAdminFaculty(fac)) continue;
            }

            // Period 7: Maths/Tough subjects strictly avoid Period 7
            if (p === 7 && isMathsOrToughSubject(cand)) continue;

            // Avoid same subject back-to-back in consecutive periods
            const leftSlot = p > 1 ? classGrid[ck][day][p - 1] : null;
            const rightSlot = p < 7 ? classGrid[ck][day][p + 1] : null;
            if ((leftSlot && isSameSubjectSlot(leftSlot, cand)) || (rightSlot && isSameSubjectSlot(rightSlot, cand))) {
              continue;
            }

            // Do not repeat if subject already has >= 2 hours today
            const timesToday = PERIODS.filter(pr => classGrid[ck][day][pr] && isSameSubjectSlot(classGrid[ck][day][pr], cand)).length;
            if (timesToday >= 2) continue;

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
              room: cand.type === "Library" ? "Library" : (cand.type === "Seminar" ? "Seminar Hall" : "LH-1")
            };
            if (fac) markFacultyBusy(fac, day, p, ck);
            filled = true;
            break;
          }

          // 2. SWAP REPAIR: If direct placement into (day, p) was blocked, find another slot in this class to swap with!
          if (!filled) {
            for (const cand of deficitList) {
              if (filled) break;
              if (!canSubjectTakeMoreHoursInClass(ck, cand)) continue;
              const candFac = (cand.facultyNames && cand.facultyNames.length > 0) ? cand.facultyNames[0] : "";
              if (candFac && !canFacultyTakeMoreHours(candFac)) continue;

              // Search all other periods in this class for a valid donor slot
              for (const donorDay of DAYS) {
                if (filled) break;
                for (const donorP of PERIODS) {
                  if (donorDay === day && donorP === p) continue;
                  const donorSlot = classGrid[ck][donorDay][donorP];
                  if (!donorSlot || donorSlot.isPinned) continue;
                  if (isBlockType(donorSlot.type) || donorSlot.isTraining) continue; // Keep lab blocks intact
                  if (donorSlot.type === "Free" || donorSlot.subjectCode === "FREE") continue;

                  const donorFac = (donorSlot.facultyNames && donorSlot.facultyNames.length > 0) ? donorSlot.facultyNames[0] : (donorSlot.facultyName || "");

                  // Step 2a: Can donorSlot move to (day, p)?
                  if (donorFac && donorFac !== "-") unmarkFacultyBusy(donorFac, donorDay, donorP);

                  const donorCanMoveToFreeSlot = (() => {
                    if (donorFac && donorFac !== "-") {
                      if (!isFacultyFree(donorFac, day, p)) return false;
                      if (causesFacultyContinuousFatigue(donorFac, day, p)) return false;
                    }
                    if (p === 1) {
                      if (!isPureTheorySubject(donorSlot)) return false;
                      if (donorFac && isSeniorAdminFaculty(donorFac)) return false;
                    }
                    if (p === 7 && isMathsOrToughSubject(donorSlot)) return false;
                    const left = p > 1 ? classGrid[ck][day][p - 1] : null;
                    const right = p < 7 ? classGrid[ck][day][p + 1] : null;
                    if ((left && isSameSubjectSlot(left, donorSlot)) || (right && isSameSubjectSlot(right, donorSlot))) return false;
                    const timesOnDay = PERIODS.filter(pr => pr !== p && classGrid[ck][day][pr] && isSameSubjectSlot(classGrid[ck][day][pr], donorSlot)).length;
                    if (timesOnDay >= 2) return false;
                    return true;
                  })();

                  // Step 2b: Can cand take the vacated (donorDay, donorP)?
                  const candCanTakeDonorSlot = (() => {
                    if (!donorCanMoveToFreeSlot) return false;
                    if (candFac && candFac !== "-") {
                      if (!isFacultyFree(candFac, donorDay, donorP)) return false;
                      if (causesFacultyContinuousFatigue(candFac, donorDay, donorP)) return false;
                    }
                    if (donorP === 1) {
                      if (!isPureTheorySubject(cand)) return false;
                      if (candFac && isSeniorAdminFaculty(candFac)) return false;
                    }
                    if (donorP === 7 && isMathsOrToughSubject(cand)) return false;
                    const left = donorP > 1 ? classGrid[ck][donorDay][donorP - 1] : null;
                    const right = donorP < 7 ? classGrid[ck][donorDay][donorP + 1] : null;
                    if ((left && isSameSubjectSlot(left, cand)) || (right && isSameSubjectSlot(right, cand))) return false;
                    const timesOnDonorDay = PERIODS.filter(pr => pr !== donorP && classGrid[ck][donorDay][pr] && isSameSubjectSlot(classGrid[ck][donorDay][pr], cand)).length;
                    if (timesOnDonorDay >= 2) return false;
                    return true;
                  })();

                  if (donorCanMoveToFreeSlot && candCanTakeDonorSlot) {
                    // SWAP SUCCESSFUL!
                    // 1. Move donorSlot to (day, p)
                    classGrid[ck][day][p] = {
                      ...donorSlot,
                      period: p,
                      time: timings[p] || DEFAULT_TIMINGS[p]
                    };
                    if (donorFac && donorFac !== "-") markFacultyBusy(donorFac, day, p, ck);

                    // 2. Place cand into (donorDay, donorP)
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
                      room: cand.type === "Library" ? "Library" : (cand.type === "Seminar" ? "Seminar Hall" : "LH-1")
                    };
                    if (candFac && candFac !== "-") markFacultyBusy(candFac, donorDay, donorP, ck);

                    filled = true;
                    break;
                  } else {
                    // Restore donorFac busy status if swap didn't proceed
                    if (donorFac && donorFac !== "-") markFacultyBusy(donorFac, donorDay, donorP, ck);
                  }
                }
              }
            }
          }

          // 3. Fallback: If no deficit subject existed, or all allocations are 100% fulfilled:
          if (!filled) {
            const libItem = clsAllocations.find(a => (a.type || "").toLowerCase().includes("lib") || (a.subjectName || "").toLowerCase().includes("lib") || (a.shortName || "").toLowerCase().includes("lib"));
            const semItem = clsAllocations.find(a => (a.type || "").toLowerCase().includes("sem") || (a.subjectName || "").toLowerCase().includes("sem") || (a.shortName || "").toLowerCase().includes("sem"));

            const hasLibToday = PERIODS.some(pr => classGrid[ck][day][pr]?.type === "Library" || classGrid[ck][day][pr]?.shortName === "LIB");
            const hasSemToday = PERIODS.some(pr => classGrid[ck][day][pr]?.type === "Seminar" || classGrid[ck][day][pr]?.shortName === "SEM");

            // STRICT USER RULE 2: Seminar and Library must NEVER appear in Period 1!
            if (p !== 1 && !hasLibToday && libItem) {
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
            } else if (p !== 1 && !hasSemToday && semItem) {
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
              // Genuinely Free Period (NEVER TUT or MENTOR!)
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

// Helper: Prunes and fixes any subjects that were assigned more hours than their allocated hoursPerWeek
// (e.g. if DAA 4h was accidentally given 6 periods, trims the 2 extra single periods back to 4h!)
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
  if (allAllocations.length === 0) return false;

  let modified = false;

  schedule.classes.forEach(cls => {
    const classAllocs = allAllocations.filter(a => {
      const yrMatch = isSameYear(a.year, cls.year);
      const secMatch = !a.section || a.section === "All" || a.section === cls.section;
      return yrMatch && secMatch;
    });

    classAllocs.forEach(allocItem => {
      const subjCode = allocItem.subjectCode || allocItem.code;
      if (!subjCode || subjCode === "FREE" || subjCode === "LIB" || subjCode === "SEM" || subjCode === "MENTOR") {
        return;
      }

      const maxAllowed = Number(allocItem.hoursPerWeek) || 4;

      // Find all slots with this subject in the class using strict subject matching
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

        // Pruning priority:
        // 1. First remove single Theory / Elective slots (never remove pinned slots and not lab blocks)
        // 2. Keep the core multi-period blocks intact!
        const singleSlots = placedSlots.filter(p => !p.slot.isTraining && !isBlockType(p.slot.type) && !p.slot.isPinned);
        const candidatesToRemove = singleSlots.length >= excessCount ? singleSlots : placedSlots.filter(p => !p.slot.isPinned);

        // Remove from the end
        for (let i = candidatesToRemove.length - 1; i >= 0 && excessCount > 0; i--) {
          const item = candidatesToRemove[i];
          const dayArr = cls.days?.[item.day] || [];
          const slotIdx = dayArr.findIndex(s => s.period === item.period);

          if (slotIdx !== -1) {
            // Replace excess with Free so healScheduleFreeSlots can fill it with deficit subjects!
            dayArr[slotIdx] = {
              period: item.period,
              time: item.slot.time || DEFAULT_TIMINGS[item.period],
              subjectCode: "FREE",
              subjectName: "Free Period",
              shortName: "Free",
              facultyName: "-",
              facultyNames: [],
              type: "Free",
              difficulty: "Normal",
              room: "LH-1"
            };

            modified = true;
            excessCount--;
          }
        }
      }
    });

    // Also prune duplicate filler/elective slots on the same day (e.g. duplicate OE on Wed or Fri where timesToday > 1)
    DAYS.forEach(day => {
      const dayArr = cls.days?.[day] || [];
      const seenElectives = {};
      dayArr.forEach((slot, slotIdx) => {
        if (!slot || slot.type === "Free" || slot.subjectCode === "FREE" || slot.isPinned) return;
        const code = (slot.shortName || slot.subjectCode || "").toUpperCase();
        // If OE or elective or non-faculty filler occurs more than once on the same day:
        if (code === "OE" || code === "OPEN ELECTIVE" || ((!slot.facultyName || slot.facultyName === "-") && (slot.type === "Theory" || slot.type === "Elective"))) {
          if (seenElectives[code]) {
            dayArr[slotIdx] = {
              period: slot.period,
              time: slot.time || DEFAULT_TIMINGS[slot.period],
              subjectCode: "FREE",
              subjectName: "Free Period",
              shortName: "Free",
              facultyName: "-",
              facultyNames: [],
              type: "Free",
              difficulty: "Normal",
              room: "LH-1"
            };
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

// Helper: Auto-fills any remaining FREE slots in an existing saved schedule and recovers deficit hours
const healScheduleFreeSlots = async (schedule, department) => {
  if (!schedule || !schedule.classes || schedule.classes.length === 0 || schedule.isLocked) {
    return false;
  }

  // Load allocations to find valid subjects for each class
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

  // Clean any legacy "TUT" or "MENTOR" placeholder slots to clean "Free" so Pass 1 can claim them for actual subjects
  schedule.classes.forEach(cls => {
    DAYS.forEach(day => {
      const slots = cls.days?.[day] || [];
      slots.forEach((s, idx) => {
        if (s) {
          const sc = (s.subjectCode || "").toUpperCase();
          const sn = (s.shortName || "").toUpperCase();
          if (sc === "TUT" || sn === "TUT" || sc === "MENTOR" || sn === "MENTOR") {
            slots[idx] = {
              period: s.period || (idx + 1),
              time: s.time || DEFAULT_TIMINGS[s.period || (idx + 1)],
              subjectCode: "FREE",
              subjectName: "Free Period",
              shortName: "Free",
              facultyName: "-",
              facultyNames: [],
              type: "Free",
              difficulty: "Normal",
              room: "-"
            };
            modified = true;
          }
        }
      });
    });
  });

  // Build current busy faculty matrix across all classes
  const busyFac = {};
  DAYS.forEach(d => {
    busyFac[d] = {};
    PERIODS.forEach(p => {
      busyFac[d][p] = new Set();
    });
  });

  schedule.classes.forEach(cls => {
    DAYS.forEach(day => {
      const slots = cls.days?.[day] || [];
      slots.forEach(s => {
        if (s && s.type !== "Free" && s.subjectCode !== "FREE" && s.shortName !== "FREE") {
          const facs = s.facultyNames || (s.facultyName ? [s.facultyName] : []);
          facs.forEach(f => {
            const clean = (f || "").trim();
            if (clean && clean !== "-") {
              busyFac[day][s.period]?.add(clean.toLowerCase());
            }
          });
        }
      });
    });
  });

  // --- PASS 1: DEFICIT RECOVERY (Recover hours for core subjects with missing quota into Free or duplicate slots) ---
  schedule.classes.forEach(cls => {
    const classAllocs = allAllocations.filter(a => {
      const yrMatch = isSameYear(a.year, cls.year);
      const secMatch = !a.section || a.section === "All" || a.section === cls.section;
      return yrMatch && secMatch;
    });

    const deficitSubjs = [];
    classAllocs.forEach(a => {
      if (isBlockType(a.type)) return; // Monolithic labs handled separately
      const needed = Number(a.hoursPerWeek) || 4;
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

    // Sort: highest deficit first, core faculty subjects first
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

      // Prioritize days where cand does not appear yet
      const candidateDays = [...DAYS].sort((d1, d2) => {
        const hasD1 = (cls.days?.[d1] || []).some(s => s && isSameSubjectSlot(s, cand)) ? 10 : 0;
        const hasD2 = (cls.days?.[d2] || []).some(s => s && isSameSubjectSlot(s, cand)) ? 10 : 0;
        return hasD1 - hasD2;
      });

      for (const day of candidateDays) {
        if (defItem.deficit <= 0) break;
        const dayArr = cls.days?.[day] || [];

        // Avoid having more than 2 periods of the same subject on one day
        const timesToday = dayArr.filter(s => s && isSameSubjectSlot(s, cand)).length;
        if (timesToday >= 2) continue;

        // Daily faculty workload check on this day
        if (fac && fac !== "-") {
          let facDailyHours = 0;
          PERIODS.forEach(pr => {
            if (busyFac[day][pr]?.has(fac.toLowerCase())) facDailyHours++;
          });
          const hasLabToday = dayArr.some(s => s && (s.type === "Laboratory" || s.type === "Lab") && s.facultyNames && s.facultyNames.some(fn => isSameFacultyName(fn, fac)));
          const maxFacCap = hasLabToday ? 4 : 3;
          if (facDailyHours >= maxFacCap) continue;
        }

        for (let pIdx = 0; pIdx < dayArr.length; pIdx++) {
          if (defItem.deficit <= 0) break;
          const s = dayArr[pIdx];
          if (s && s.isPinned) continue; // Pinned slots are protected!
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
            } else if (s.type === "Library" || s.type === "Seminar" || s.type === "Mentoring" || sCode === "LIB" || sCode === "SEM" || sCode === "MENTOR") {
              const sameTypeToday = dayArr.filter(x => x.type === s.type || x.shortName === sCode).length;
              if (sameTypeToday > 1) isReplaceableFiller = true;
            }
          }

          if (!isFree && !isReplaceableFiller) continue;

          // Zero Clash check: Faculty must not teach another class in period p!
          if (fac && fac !== "-") {
            // USER RULE 5: HOD, ASST HOD, and ASP never in Period 1 or Period 2!
            if (p <= 2 && isSeniorAdminFaculty(fac, staffMap)) continue;

            if (busyFac[day][p]?.has(fac.toLowerCase())) continue;

            // USER RULE 3: Zero consecutive periods for faculty
            const leftBusy = p > 1 && busyFac[day][p - 1]?.has(fac.toLowerCase());
            const rightBusy = p < 7 && busyFac[day][p + 1]?.has(fac.toLowerCase());
            if (leftBusy || rightBusy) continue;

            // Lunch break boundary
            if (p === 4 && busyFac[day][5]?.has(fac.toLowerCase())) continue;
            if (p === 5 && busyFac[day][4]?.has(fac.toLowerCase())) continue;
          }

          // Class constraint: avoid consecutive repeat in same class
          const left = dayArr.find(x => x.period === p - 1);
          const right = dayArr.find(x => x.period === p + 1);
          if ((left && isSameSubjectSlot(left, cand)) || (right && isSameSubjectSlot(right, cand))) {
            continue;
          }

          // Math/Tough avoids period 7
          const isMath = isMathsOrToughSubject(cand);
          if (p === 7 && isMath) continue;

          // If slot had an existing busy faculty, remove from busyFac
          if (s && s.facultyNames) {
            s.facultyNames.forEach(fn => {
              const clean = (fn || "").trim().toLowerCase();
              if (clean && clean !== "-") busyFac[day][p]?.delete(clean);
            });
          }

          // Replace slot with Deficit Subject!
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
            room: cand.type === "Library" ? "Library" : (cand.type === "Seminar" ? "Seminar Hall" : "LH-1")
          };

          if (fac && fac !== "-") {
            busyFac[day][p]?.add(fac.toLowerCase());
          }

          defItem.deficit--;
          modified = true;
          break; // Spread to next day
        }
      }

      // SWAP REPAIR: If direct placement into any free slot failed (e.g. cand faculty is senior admin HOD/ASP blocked from morning P1-P2)
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
              if (sc === "OE" || targetSlot.type === "Library" || targetSlot.type === "Seminar" || sc === "LIB" || sc === "SEM") {
                isReplaceable = true;
              }
            }
            if (!isFree && !isReplaceable) continue;

            // Search for donor slot in this class
            for (const donorDay of DAYS) {
              if (defItem.deficit <= 0) break;
              const donorDayArr = cls.days?.[donorDay] || [];

              for (let dpIdx = 0; dpIdx < donorDayArr.length; dpIdx++) {
                if (donorDay === targetDay && dpIdx === tpIdx) continue;
                const donorSlot = donorDayArr[dpIdx];
                if (!donorSlot || donorSlot.isPinned) continue;
                if (donorSlot.isTraining || isBlockType(donorSlot.type)) continue;
                if (donorSlot.type === "Free" || donorSlot.subjectCode === "FREE") continue;
                if (isSameSubjectSlot(donorSlot, cand)) continue;

                const donorP = donorSlot.period || (dpIdx + 1);
                const donorFacs = donorSlot.facultyNames || (donorSlot.facultyName ? [donorSlot.facultyName] : []);
                const donorFac = donorFacs[0] || "";

                // Check 1: Can donorSlot move to (targetDay, targetP)?
                if (donorFac && donorFac !== "-") {
                  busyFac[donorDay][donorP]?.delete(donorFac.toLowerCase());
                }

                const donorCanMove = (() => {
                  if (donorFac && donorFac !== "-") {
                    if (targetP <= 2 && isSeniorAdminFaculty(donorFac, staffMap)) return false;
                    if (busyFac[targetDay][targetP]?.has(donorFac.toLowerCase())) return false;
                    if (targetP > 1 && busyFac[targetDay][targetP - 1]?.has(donorFac.toLowerCase())) return false;
                    if (targetP < 7 && busyFac[targetDay][targetP + 1]?.has(donorFac.toLowerCase())) return false;
                    if (targetP === 4 && busyFac[targetDay][5]?.has(donorFac.toLowerCase())) return false;
                    if (targetP === 5 && busyFac[targetDay][4]?.has(donorFac.toLowerCase())) return false;
                  }
                  if (targetP === 1 && !isPureTheorySubject(donorSlot)) return false;
                  if (targetP === 7 && isMathsOrToughSubject(donorSlot)) return false;
                  const left = targetDayArr.find(x => x.period === targetP - 1);
                  const right = targetDayArr.find(x => x.period === targetP + 1);
                  if ((left && isSameSubjectSlot(left, donorSlot)) || (right && isSameSubjectSlot(right, donorSlot))) return false;
                  const timesOnTarget = targetDayArr.filter(x => x.period !== targetP && isSameSubjectSlot(x, donorSlot)).length;
                  if (timesOnTarget >= 2) return false;
                  return true;
                })();

                // Check 2: Can cand take (donorDay, donorP)?
                const candCanTake = (() => {
                  if (!donorCanMove) return false;
                  if (fac && fac !== "-") {
                    if (donorP <= 2 && isSeniorAdminFaculty(fac, staffMap)) return false;
                    if (busyFac[donorDay][donorP]?.has(fac.toLowerCase())) return false;
                    if (donorP > 1 && busyFac[donorDay][donorP - 1]?.has(fac.toLowerCase())) return false;
                    if (donorP < 7 && busyFac[donorDay][donorP + 1]?.has(fac.toLowerCase())) return false;
                    if (donorP === 4 && busyFac[donorDay][5]?.has(fac.toLowerCase())) return false;
                    if (donorP === 5 && busyFac[donorDay][4]?.has(fac.toLowerCase())) return false;
                  }
                  if (donorP === 1 && !isPureTheorySubject(cand)) return false;
                  if (donorP === 7 && isMathsOrToughSubject(cand)) return false;
                  const left = donorDayArr.find(x => x.period === donorP - 1);
                  const right = donorDayArr.find(x => x.period === donorP + 1);
                  if ((left && isSameSubjectSlot(left, cand)) || (right && isSameSubjectSlot(right, cand))) return false;
                  const timesOnDonor = donorDayArr.filter(x => x.period !== donorP && isSameSubjectSlot(x, cand)).length;
                  if (timesOnDonor >= 2) return false;
                  return true;
                })();

                if (donorCanMove && candCanTake) {
                  // Execute Swap!
                  targetDayArr[tpIdx] = {
                    ...donorSlot,
                    period: targetP,
                    time: targetSlot?.time || DEFAULT_TIMINGS[targetP]
                  };
                  if (donorFac && donorFac !== "-") {
                    busyFac[targetDay][targetP]?.add(donorFac.toLowerCase());
                  }

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
                    room: cand.type === "Library" ? "Library" : (cand.type === "Seminar" ? "Seminar Hall" : "LH-1")
                  };
                  if (fac && fac !== "-") {
                    busyFac[donorDay][donorP]?.add(fac.toLowerCase());
                  }

                  defItem.deficit--;
                  modified = true;
                  break;
                } else {
                  if (donorFac && donorFac !== "-") {
                    busyFac[donorDay][donorP]?.add(donorFac.toLowerCase());
                  }
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
    const classAllocs = allAllocations.filter(a => {
      const yrMatch = isSameYear(a.year, cls.year);
      const secMatch = !a.section || a.section === "All" || a.section === cls.section;
      return yrMatch && secMatch;
    });

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

          // 1. Try to find a Theory subject whose faculty is free AND has not reached weekly quota
          for (const cand of candidatePool) {
            const t = (cand.type || "").toLowerCase();
            if (t.includes("lab") || t.includes("project")) continue;

            const maxNeeded = Number(cand.hoursPerWeek) || 4;

            // Strict quota check using isSameSubjectSlot
            let placedInClass = 0;
            DAYS.forEach(d => {
              (cls.days?.[d] || []).forEach(slotItem => {
                if (slotItem && isSameSubjectSlot(slotItem, cand)) {
                  placedInClass++;
                }
              });
            });
            if (placedInClass >= maxNeeded) continue;

            const facs = cand.facultyNames || (cand.facultyName ? [cand.facultyName] : []);
            const fac = facs[0] || "";

            if (fac && fac !== "-") {
              const facAllocTotal = allAllocations.reduce((acc, a) => {
                if (a.facultyNames && a.facultyNames.some(fn => isSameFacultyName(fn, fac))) {
                  return acc + (Number(a.hoursPerWeek) || 0);
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

              if (busyFac[day][p]?.has(fac.toLowerCase())) continue;
              // USER RULE 5: HOD, ASST HOD, and ASP never in Period 1 or Period 2!
              if (p <= 2 && isSeniorAdminFaculty(fac, staffMap)) continue;
              // STRICT: Faculty must NOT be teaching adjacent period p - 1 or p + 1!
              if (p > 1 && busyFac[day][p - 1]?.has(fac.toLowerCase())) continue;
              if (p < 7 && busyFac[day][p + 1]?.has(fac.toLowerCase())) continue;
              if (p === 4 && busyFac[day][5]?.has(fac.toLowerCase())) continue;
              if (p === 5 && busyFac[day][4]?.has(fac.toLowerCase())) continue;
            }

            // Avoid same subject in adjacent period
            const left = slots.find(x => x.period === p - 1);
            const right = slots.find(x => x.period === p + 1);
            if ((left && isSameSubjectSlot(left, cand)) || (right && isSameSubjectSlot(right, cand))) {
              continue;
            }

            // Avoid math in period 7
            const isMath = isMathsOrToughSubject(cand);
            if (p === 7 && isMath) continue;

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
              room: cand.type === "Library" ? "Library" : (cand.type === "Seminar" ? "Seminar Hall" : "LH-1")
            };
            if (fac && fac !== "-") {
              busyFac[day][p]?.add(fac.toLowerCase());
            }
            break;
          }

          // 2. Fallback to Seminar, Library, or Mentoring
          if (!chosen) {
            const hasLib = slots.some(x => x.type === "Library" || x.shortName === "LIB");
            const hasSem = slots.some(x => x.type === "Seminar" || x.shortName === "SEM");

            // STRICT USER RULE 2: Seminar and Library must NEVER appear in Period 1!
            if (p !== 1 && !hasSem) {
              chosen = {
                period: p,
                time: s?.time || DEFAULT_TIMINGS[p],
                subjectCode: "SEM",
                subjectName: "Seminar / Technical Presentation",
                shortName: "SEM",
                facultyName: "-",
                facultyNames: [],
                type: "Seminar",
                difficulty: "Light",
                room: "Seminar Hall"
              };
            } else if (p !== 1 && !hasLib) {
              chosen = {
                period: p,
                time: s?.time || DEFAULT_TIMINGS[p],
                subjectCode: "LIB",
                subjectName: "Library / Digital Library",
                shortName: "LIB",
                facultyName: "-",
                facultyNames: [],
                type: "Library",
                difficulty: "Light",
                room: "Library"
              };
            } else {
              chosen = {
                period: p,
                time: s?.time || DEFAULT_TIMINGS[p],
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
