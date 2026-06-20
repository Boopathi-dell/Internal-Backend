const express = require("express");
const router = express.Router();
const Advisor = require("../models/Advisor");
const jwt = require("jsonwebtoken");
const JWT_SECRET = "mec_result_system_secret_2025";

// Helper to authenticate admin
const adminAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "No token provided" });
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== "admin" && decoded.role !== "printAdmin") {
      return res.status(403).json({ error: "Access denied" });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
};

// GET ALL ADVISORS (Admin side)
router.get("/", adminAuth, async (req, res) => {
  try {
    const advisors = await Advisor.find().sort({ programme: 1, department: 1, year: 1, section: 1 });
    res.json(advisors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST ADD/UPDATE ADVISOR (Admin side)
router.post("/", adminAuth, async (req, res) => {
  try {
    const { programme, department, year, section, advisorName } = req.body;
    
    if (!programme || !department || !year || !section || !advisorName) {
      return res.status(400).json({ error: "All fields are required" });
    }

    // Upsert logic: find by programme, department, year, section and update advisorName
    const advisor = await Advisor.findOneAndUpdate(
      { programme, department, year, section },
      { advisorName },
      { new: true, upsert: true, runValidators: true }
    );

    res.json(advisor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE ADVISOR MAPPING (Admin side)
router.delete("/:id", adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await Advisor.findByIdAndDelete(id);
    res.json({ message: "Class advisor mapping deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// LOOKUP ADVISOR (Student/User side)
router.get("/lookup", async (req, res) => {
  try {
    const { programme, department, year, section } = req.query;
    
    if (!programme || !department || !year || !section) {
      return res.status(400).json({ error: "programme, department, year, and section parameters are required" });
    }

    const advisor = await Advisor.findOne({ programme, department, year, section });
    if (!advisor) {
      return res.status(404).json({ error: "Advisor not found" });
    }

    res.json(advisor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
