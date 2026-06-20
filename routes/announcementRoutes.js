const express = require("express");
const router = express.Router();
const Announcement = require("../models/Announcement");
const jwt = require("jsonwebtoken");
const JWT_SECRET = "mec_result_system_secret_2025";

// Helper middleware to authenticate Admin or Faculty (User)
const adminOrFacultyAuth = (req, res, next) => {
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

// GET ALL ANNOUNCEMENTS (Admin/Faculty side)
router.get("/", adminOrFacultyAuth, async (req, res) => {
  try {
    const announcements = await Announcement.find().sort({ createdAt: -1 });
    res.json(announcements);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST CREATE ANNOUNCEMENT (Admin/Faculty side)
router.post("/", adminOrFacultyAuth, async (req, res) => {
  try {
    const { title, content, category, targetProgramme, targetDepartment, targetYear, targetSection, image } = req.body;

    if (!title || !content || !category) {
      return res.status(400).json({ error: "Title, content, and category are required" });
    }

    let createdBy = "Administrator";
    if (req.user.role === "printAdmin") {
      createdBy = "Print Admin";
    } else if (req.user.role === "user") {
      createdBy = req.user.name || "Faculty Member";
    }

    const announcement = new Announcement({
      title,
      content,
      category,
      targetProgramme: targetProgramme || "All",
      targetDepartment: targetDepartment || "CSE",
      targetYear: targetYear || ["All"],
      targetSection: targetSection || ["All"],
      image: image || null,
      createdBy
    });

    await announcement.save();
    res.status(201).json(announcement);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE ANNOUNCEMENT (Admin/Faculty side)
router.delete("/:id", adminOrFacultyAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await Announcement.findByIdAndDelete(id);
    res.json({ message: "Announcement deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET FILTERED ANNOUNCEMENTS FOR STUDENTS
router.get("/student", async (req, res) => {
  try {
    const { programme, department, year, section } = req.query;

    if (!programme || !department || !year || !section) {
      return res.status(400).json({ error: "programme, department, year, and section query parameters are required" });
    }

    // Find announcements targeting "All" or the student's specific class configuration
    const announcements = await Announcement.find({
      $and: [
        { $or: [{ targetProgramme: "All" }, { targetProgramme: programme }] },
        { $or: [{ targetDepartment: "All" }, { targetDepartment: department }] },
        { targetYear: { $in: ["All", year] } },
        { targetSection: { $in: ["All", section] } }
      ]
    }).sort({ createdAt: -1 });

    res.json(announcements);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
