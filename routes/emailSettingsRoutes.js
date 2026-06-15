const express = require("express");
const router = express.Router();
const EmailSettings = require("../models/EmailSettings");

// Get settings
router.get("/", async (req, res) => {
  try {
    let settings = await EmailSettings.findOne();
    if (!settings) {
      settings = new EmailSettings();
      await settings.save();
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update settings
router.put("/", async (req, res) => {
  try {
    const { year1Email, year2Email, year3Email, year4Email } = req.body;
    let settings = await EmailSettings.findOne();
    if (!settings) {
      settings = new EmailSettings();
    }
    settings.year1Email = year1Email || "";
    settings.year2Email = year2Email || "";
    settings.year3Email = year3Email || "";
    settings.year4Email = year4Email || "";
    
    await settings.save();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
