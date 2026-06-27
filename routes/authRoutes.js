const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");
const User = require("../models/User");
const Activity = require("../models/Activity");
const ClassData = require("../models/Class");
const YearApproval = require("../models/YearApproval");
const JWT_SECRET = "mec_result_system_secret_2025";

// ADMIN LOGIN
router.post("/admin/login", async (req, res) => {
  try {
    const { email, password, securityCode } = req.body;
    let admin = await Admin.findOne({ email });

    // Auto-seed admins on first login if they don't exist yet
    if (!admin) {
      if (email === "boopathi.mec.cse@gmail.com" && password === "Boopathi@1431") {
        const hashedPassword = await bcrypt.hash(password, 10);
        admin = await Admin.create({ email, password: hashedPassword, role: "admin" });
        console.log("Full Admin account auto-created from login prompt!");
      } else if (email === "print.mec.cse@gmail.com" && password === "Print@1431") {
        const hashedPassword = await bcrypt.hash(password, 10);
        admin = await Admin.create({ email, password: hashedPassword, role: "printAdmin" });
        console.log("Print Admin account auto-created from login prompt!");
      }
    }

    if (!admin) return res.status(401).json({ error: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });

    // Security Code Logic
    if (admin.securityCode && admin.securityCode.trim() !== "") {
      if (!securityCode) {
        return res.json({ requireSecurityCode: true, email: admin.email });
      }
      if (admin.securityCode !== securityCode) {
        return res.status(401).json({ error: "Invalid Security Code" });
      }
    }

    // Fallback role to 'admin' if not set in older documents
    let adminRole = admin.role || "admin";

    // Force the correct role for print admin to fix DB inconsistencies
    if (admin.email === "print.mec.cse@gmail.com") {
      adminRole = "printAdmin";
      if (admin.role !== "printAdmin") {
        admin.role = "printAdmin";
        await admin.save();
      }
    }

    const token = jwt.sign({ id: admin._id, role: adminRole }, JWT_SECRET, { expiresIn: "24h" });
    res.json({ token, role: adminRole, email: admin.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET SECURITY QUESTION
router.post("/admin/get-security-question", async (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(401).json({ error: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });

    if (!admin.securityQuestion) {
      return res.status(400).json({ error: "No security question set for this account." });
    }

    res.json({ question: admin.securityQuestion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// VERIFY SECURITY ANSWER
router.post("/admin/verify-security-answer", async (req, res) => {
  try {
    const { email, password, securityAnswer } = req.body;
    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(401).json({ error: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });

    if (!admin.securityAnswer) {
      return res.status(400).json({ error: "No security answer set for this account." });
    }

    if (admin.securityAnswer.toLowerCase() !== securityAnswer.toLowerCase()) {
      return res.status(401).json({ error: "Incorrect Answer" });
    }

    // Login successful
    let adminRole = admin.role || "admin";
    const token = jwt.sign({ id: admin._id, role: adminRole }, JWT_SECRET, { expiresIn: "24h" });
    res.json({ token, role: adminRole, email: admin.email, message: "Logged in via Security Question" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SET SECURITY (Protected Route)
router.post("/admin/set-security", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "No token provided" });
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== "admin" && decoded.role !== "printAdmin") {
      return res.status(403).json({ error: "Access denied" });
    }

    const { securityCode, securityQuestion, securityAnswer } = req.body;
    
    const admin = await Admin.findById(decoded.id);
    if (!admin) return res.status(404).json({ error: "Admin not found" });

    admin.securityCode = securityCode;
    admin.securityQuestion = securityQuestion;
    admin.securityAnswer = securityAnswer;
    await admin.save();

    res.json({ message: "Security settings updated successfully!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET CURRENT SECURITY SETTINGS (Protected Route)
router.get("/admin/get-security", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "No token provided" });
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== "admin" && decoded.role !== "printAdmin") {
      return res.status(403).json({ error: "Access denied" });
    }

    const admin = await Admin.findById(decoded.id);
    if (!admin) return res.status(404).json({ error: "Admin not found" });

    res.json({
      securityCode: admin.securityCode || "",
      securityQuestion: admin.securityQuestion || "",
      securityAnswer: admin.securityAnswer || ""
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// USER REGISTER
router.post("/user/register", async (req, res) => {
  try {
    const { name, email, department, designation, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: "Email already registered" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, email, department, designation, password: hashedPassword });
    await user.save();

    res.json({ message: "Registration successful! Waiting for admin approval." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// USER LOGIN
router.post("/user/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
    if (!user.approved) return res.status(403).json({ error: "Account not yet approved by admin" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign({ id: user._id, role: "user", name: user.name }, JWT_SECRET, { expiresIn: "24h" });

    // Track login activity
    await new Activity({
      userId: user._id,
      userName: user.name,
      action: "login",
      details: `${user.name} logged in`
    }).save();

    res.json({ token, role: "user", name: user.name, userId: user._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET ALL USERS (Admin only)
router.get("/users", async (req, res) => {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// APPROVE/REJECT USER
router.post("/users/:id/approve", async (req, res) => {
  try {
    const { approved } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, { approved }, { new: true }).select("-password");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE USER
router.delete("/users/:id", async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET YEAR APPROVALS
router.get("/admin/year-approvals", async (req, res) => {
  try {
    const approvals = await YearApproval.find();
    res.json(approvals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST YEAR APPROVALS
router.post("/admin/year-approvals", async (req, res) => {
  try {
    const { year, isApproved } = req.body;
    const approval = await YearApproval.findOneAndUpdate(
      { year },
      { isApproved },
      { new: true, upsert: true }
    );
    res.json(approval);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET ACTIVITY LOG
router.get("/activities", async (req, res) => {
  try {
    // Auto-cleanup logs older than 20 days
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    await Activity.deleteMany({ timestamp: { $lt: twentyDaysAgo } });

    const activities = await Activity.find().sort({ timestamp: -1 }).limit(100);
    res.json(activities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// TRACK SUBMIT ACTIVITY  
router.post("/activity", async (req, res) => {
  try {
    const { userId, userName, action, details } = req.body;
    await new Activity({ userId, userName, action, details }).save();
    res.json({ message: "Activity logged" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// STUDENT LOGIN
router.post("/student/login", async (req, res) => {
  try {
    const { regNo, dob } = req.body;
    if (!regNo || !dob) {
      return res.status(400).json({ error: "Roll number and Date of Birth are required" });
    }

    const normalizedRegNo = regNo.trim().toUpperCase();
    const normalizedDob = dob.trim();

    // Find any class containing this student (exclude deleted classes)
    const classes = await ClassData.find({ "students.regNo": normalizedRegNo, isDeleted: { $ne: true } });
    if (classes.length === 0) {
      return res.status(404).json({ error: "Please contact this number 9597504603 and update your details" });
    }

    // Find if any class has a matching DOB for this student
    let studentObj = null;
    for (const cls of classes) {
      const student = cls.students.find(s => s.regNo === normalizedRegNo);
      if (student && student.dob && student.dob.trim() === normalizedDob) {
        studentObj = student;
        break;
      }
    }

    // If student DOB is not set in any class, or if it doesn't match
    if (!studentObj) {
      let dobNotSet = true;
      for (const cls of classes) {
        const student = cls.students.find(s => s.regNo === normalizedRegNo);
        if (student && student.dob && student.dob.trim()) {
          dobNotSet = false;
          break;
        }
      }

      if (dobNotSet) {
        return res.status(400).json({ error: "Please contact this number 9597504603 and update your details" });
      } else {
        return res.status(401).json({ error: "Please contact this number 9597504603 and update your details" });
      }
    }

    const token = jwt.sign(
      { id: normalizedRegNo, role: "student", regNo: normalizedRegNo, name: studentObj.name },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.json({
      token,
      role: "student",
      name: studentObj.name,
      regNo: normalizedRegNo
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET STUDENT RESULTS
router.get("/student/results", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "No token provided" });
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== "student") return res.status(403).json({ error: "Access denied" });

    const regNo = decoded.regNo;

    // Find all classes that contain a student with this regNo (exclude deleted classes)
    let classes = await ClassData.find({ "students.regNo": regNo, isDeleted: { $ne: true } });

    // Filter by year approvals
    const approvals = await YearApproval.find();
    const approvedMap = {};
    approvals.forEach(a => approvedMap[a.year] = a.isApproved);

    classes = classes.filter(cls => {
      if (!cls.yearSemSec) return true;
      const year = cls.yearSemSec.split('/')[0];
      // If it exists in DB and is false, hide it. Otherwise (true or not in DB), show it.
      return approvedMap[year] !== false;
    });

    // Process results grouped by examName or className
    const results = classes.map(cls => {
      // Find the specific student in this class
      const student = cls.students.find(s => s.regNo === regNo);

      // Map marks to subjects
      const subjectMarks = cls.subjects.map((subjCode, index) => {
        // find subject details in courseDetails if it exists
        const details = cls.courseDetails.find(cd => cd.courseCode === subjCode);
        return {
          courseCode: subjCode,
          courseName: details ? details.courseName : "",
          shortName: details ? details.shortName : "",
          facultyName: details ? details.facultyName : "",
          mark: student.marks[index] !== undefined ? student.marks[index] : "",
          passMark: cls.passMark,
          markPerSubject: cls.markPerSubject
        };
      });

      return {
        className: cls.className,
        examName: cls.examName,
        department: cls.department,
        yearSemSec: cls.yearSemSec,
        programme: cls.programme,
        date: cls.date,
        passMark: cls.passMark,
        markPerSubject: cls.markPerSubject,
        studentName: student.name,
        gender: student.gender,
        studentType: student.studentType,
        marks: subjectMarks,
        total: student.total,
        percentage: student.percentage,
        result: student.result
      };
    });

    res.json({
      name: results[0]?.studentName || decoded.name || "",
      regNo,
      results
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
