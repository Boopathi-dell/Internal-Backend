const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");
const User = require("../models/User");
const Activity = require("../models/Activity");
const ClassData = require("../models/Class");

const JWT_SECRET = "mec_result_system_secret_2025";

// ADMIN LOGIN
router.post("/admin/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    let admin = await Admin.findOne({ email });

    // Auto-seed admin on first login if it doesn't exist yet
    if (!admin && email === "boopathi.mec.cse@gmail.com" && password === "Boopathi@1431") {
      const hashedPassword = await bcrypt.hash(password, 10);
      admin = await Admin.create({ email, password: hashedPassword });
      console.log("Admin account auto-created from login prompt!");
    }

    if (!admin) return res.status(401).json({ error: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign({ id: admin._id, role: "admin" }, JWT_SECRET, { expiresIn: "24h" });
    res.json({ token, role: "admin", email: admin.email });
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

// GET ACTIVITY LOG
router.get("/activities", async (req, res) => {
  try {
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

    // Find any class containing this student
    const classes = await ClassData.find({ "students.regNo": normalizedRegNo });
    if (classes.length === 0) {
      return res.status(404).json({ error: "Student not found in the roster" });
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
        return res.status(400).json({ error: "Date of Birth not set in system. Please contact Admin/Staff." });
      } else {
        return res.status(401).json({ error: "Incorrect Date of Birth" });
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

    // Find all classes that contain a student with this regNo
    const classes = await ClassData.find({ "students.regNo": regNo });

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
