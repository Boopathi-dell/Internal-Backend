const express = require("express");
const router = express.Router();
const LetterTemplate = require("../models/LetterTemplate");

// GET letter template (always returns one document)
router.get("/", async (req, res) => {
  try {
    let template = await LetterTemplate.findOne();
    if (!template) {
      template = await LetterTemplate.create({});
    }
    res.json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SAVE / UPDATE letter template
router.post("/", async (req, res) => {
  try {
    let template = await LetterTemplate.findOne();
    if (!template) {
      template = new LetterTemplate(req.body);
    } else {
      Object.assign(template, req.body);
    }
    await template.save();
    res.json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
