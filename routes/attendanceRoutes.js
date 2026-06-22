const express = require("express");
const router = express.Router();
const Attendance = require("../models/Attendance");
const ClassData = require("../models/Class");
const Advisor = require("../models/Advisor");
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const JWT_SECRET = "mec_result_system_secret_2025";

// Middleware to authenticate Faculty (User) or Admin
const facultyOrAdminAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "No token provided" });
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== "admin" && decoded.role !== "printAdmin" && decoded.role !== "user") {
      return res.status(403).json({ error: "Access denied" });
    }
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
};

// Middleware to authenticate Student
const studentAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "No token provided" });
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== "student") {
      return res.status(403).json({ error: "Access denied" });
    }
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
};

// CHECK IF USER IS AN ADVISOR
router.get("/check-advisor-status", facultyOrAdminAuth, async (req, res) => {
  try {
    if (req.user.role === "admin" || req.user.role === "printAdmin") {
      return res.json({ isAdvisor: true });
    }

    const advisor = await Advisor.findOne({ advisorName: req.user.name });
    res.json({ isAdvisor: !!advisor });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET CLASSES ASSIGNED TO CURRENT USER
router.get("/my-classes", facultyOrAdminAuth, async (req, res) => {
  try {
    const classes = await ClassData.find({ isDeleted: { $ne: true } });

    if (req.user.role === "admin" || req.user.role === "printAdmin") {
      // Admins can see all classes
      const mapped = classes.map(cls => {
        const parts = (cls.yearSemSec || "").split("/");
        return {
          className: cls.className,
          programme: cls.programme,
          department: cls.department,
          year: parts[0] || "II",
          section: parts[2] || "A"
        };
      });
      return res.json(mapped);
    }

    // Faculty: only classes they are advisor for
    const advisors = await Advisor.find({ advisorName: req.user.name });
    if (advisors.length === 0) {
      return res.json([]);
    }

    const matchingClasses = classes.filter(cls => {
      if (!cls.yearSemSec) return false;
      const parts = cls.yearSemSec.split("/");
      const clsYear = parts[0];
      const clsSec = parts[2];
      return advisors.some(adv =>
        adv.programme === cls.programme &&
        adv.department === cls.department &&
        adv.year === clsYear &&
        adv.section === clsSec
      );
    });

    const result = matchingClasses.map(cls => {
      const parts = cls.yearSemSec.split("/");
      return {
        className: cls.className,
        programme: cls.programme,
        department: cls.department,
        year: parts[0],
        section: parts[2]
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET STUDENTS AND SAVED ATTENDANCE FOR A CLASS
router.get("/class-students", facultyOrAdminAuth, async (req, res) => {
  try {
    const { programme, department, year, section, date } = req.query;
    if (!programme || !department || !year || !section || !date) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    // Check if attendance has already been saved
    const savedAtt = await Attendance.findOne({ date, programme, department, year, section });
    if (savedAtt) {
      return res.json(savedAtt);
    }

    // Not saved yet, fetch current class roster
    // Map year and section back to yearSemSec regex
    const regex = new RegExp("^" + year + "/.*/" + section + "$");
    const cls = await ClassData.findOne({ programme, department, yearSemSec: regex, isDeleted: { $ne: true } });
    if (!cls) {
      return res.status(404).json({ error: "Class roster not found. Please set up the class roster first." });
    }

    // Return default response (all Present)
    const defaultStudents = cls.students.map(s => ({
      regNo: s.regNo,
      name: s.name,
      status: "Present"
    })).sort((a, b) => a.regNo.localeCompare(b.regNo));

    res.json({
      date,
      programme,
      department,
      year,
      section,
      students: defaultStudents,
      totalCount: defaultStudents.length,
      presentCount: defaultStudents.length,
      absentCount: 0,
      submitted: false
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SAVE ATTENDANCE
router.post("/save", facultyOrAdminAuth, async (req, res) => {
  try {
    const { date, programme, department, year, section, students, submitted } = req.body;
    if (!date || !programme || !department || !year || !section || !Array.isArray(students)) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Restrict date to today for Faculty (user role)
    if (req.user.role === "user") {
      const now = new Date();
      const istDate = new Date(now.getTime() + 19800000); // UTC + 5:50 hours
      const todayStr = istDate.toISOString().split("T")[0]; // YYYY-MM-DD
      if (date !== todayStr) {
        return res.status(403).json({ error: "Faculty can only submit/edit attendance for today's date." });
      }
    }

    // Lookup advisor name
    const advisor = await Advisor.findOne({ programme, department, year, section });
    const advisorName = advisor ? advisor.advisorName : (req.user.name || "Faculty");

    const totalCount = students.length;
    const presentCount = students.filter(s => s.status === "Present").length;
    const absentCount = students.filter(s => s.status === "Absent").length;

    const attendance = await Attendance.findOneAndUpdate(
      { date, programme, department, year, section },
      {
        advisorName,
        students,
        totalCount,
        presentCount,
        absentCount,
        submitted: submitted !== undefined ? submitted : true
      },
      { upsert: true, new: true, runValidators: true }
    );

    res.json(attendance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CONSOLIDATED DAILY ATTENDANCE REPORT
router.get("/daily-report", facultyOrAdminAuth, async (req, res) => {
  try {
    const { date, department } = req.query;
    if (!date || !department) {
      return res.status(400).json({ error: "Date and department are required parameters" });
    }

    // Use Advisor collection as single source of truth for unique class list
    // (ClassData has multiple documents per class - one per exam, causing duplicates)
    const advisors = await Advisor.find({ department });

    // Retrieve attendance records already submitted for this date
    const attendanceRecords = await Attendance.find({ date, department });

    // For pending classes, get student count from ClassData (latest document per class)
    // Build a map: "year-section" -> student count
    const allClasses = await ClassData.find({ department, isDeleted: { $ne: true } });
    const studentCountMap = {};
    allClasses.forEach(cls => {
      if (!cls.yearSemSec) return;
      const parts = cls.yearSemSec.split("/");
      const yr = parts[0];
      const sec = parts[2];
      if (!yr || !sec) return;
      const key = `${cls.programme}-${yr}-${sec}`;
      // Take the max student count (most populated exam doc for that class)
      if (!studentCountMap[key] || cls.students.length > studentCountMap[key]) {
        studentCountMap[key] = cls.students.length;
      }
    });

    const reportData = advisors.map(adv => {
      const att = attendanceRecords.find(a =>
        a.programme === adv.programme &&
        a.year === adv.year &&
        a.section === adv.section
      );

      const countKey = `${adv.programme}-${adv.year}-${adv.section}`;
      const totalStudents = att ? att.totalCount : (studentCountMap[countKey] || 0);

      return {
        programme: adv.programme,
        department: adv.department,
        year: adv.year,
        section: adv.section,
        advisorName: adv.advisorName,
        total: totalStudents,
        present: att ? att.presentCount : "-",
        absent: att ? att.absentCount : "-",
        submitted: att ? att.submitted : false
      };
    });

    // Sort logically: Year -> Section
    const yearOrder = { "I": 1, "II": 2, "III": 3, "IV": 4 };
    reportData.sort((a, b) => {
      const ya = yearOrder[a.year] || 9;
      const yb = yearOrder[b.year] || 9;
      if (ya !== yb) return ya - yb;
      return a.section.localeCompare(b.section);
    });

    res.json(reportData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// STUDENT VIEW ATTENDANCE HISTORY
router.get("/student-history", studentAuth, async (req, res) => {
  try {
    const regNo = req.user.regNo;

    // Find all attendance records where this student is present/absent
    const attendanceRecords = await Attendance.find({
      "students.regNo": regNo
    }).sort({ date: -1 });

    const history = attendanceRecords.map(record => {
      const studentObj = record.students.find(s => s.regNo === regNo);
      return {
        date: record.date,
        status: studentObj ? studentObj.status : "Present",
        year: record.year,
        section: record.section,
        advisorName: record.advisorName
      };
    });

    // Calculate overall stats
    const totalDays = history.length;
    const presentDays = history.filter(h => h.status === "Present").length;
    const absentDays = history.filter(h => h.status === "Absent").length;
    const percentage = totalDays > 0 ? Number(((presentDays / totalDays) * 100).toFixed(2)) : 0;

    res.json({
      regNo,
      totalDays,
      presentDays,
      absentDays,
      percentage,
      history
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
