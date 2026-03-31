const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");
const User = require("../models/User");
const Activity = require("../models/Activity");

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

module.exports = router;
