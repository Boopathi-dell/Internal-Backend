const express = require("express");
const WorkingDays = require("../models/WorkingDays");

const router = express.Router();

// GET all working days config
router.get("/", async (req, res) => {
  try {
    const workingDays = await WorkingDays.find({});
    res.json(workingDays);
  } catch (err) {
    console.error("Error fetching working days:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST to create or update working days config
router.post("/", async (req, res) => {
  const { year, startDate, endDate } = req.body;
  if (!year || !startDate || !endDate) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const config = await WorkingDays.findOneAndUpdate(
      { year },
      { startDate, endDate },
      { new: true, upsert: true }
    );
    res.json(config);
  } catch (err) {
    console.error("Error saving working days:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
