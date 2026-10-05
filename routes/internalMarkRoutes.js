const express = require("express");
const router = express.Router();
const InternalMarkTemplate = require("../models/InternalMarkTemplate");

// Get all templates
router.get("/", async (req, res) => {
  try {
    const templates = await InternalMarkTemplate.find().sort({ createdAt: -1 });
    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get active template
router.get("/active", async (req, res) => {
  try {
    const template = await InternalMarkTemplate.findOne({ isActive: true });
    res.json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new template
router.post("/", async (req, res) => {
  try {
    const { templateName, columns, isActive } = req.body;
    if (isActive) {
      await InternalMarkTemplate.updateMany({}, { isActive: false });
    }
    const newTemplate = new InternalMarkTemplate({ templateName, columns, isActive });
    await newTemplate.save();
    res.json(newTemplate);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update template
router.put("/:id", async (req, res) => {
  try {
    const { templateName, columns, isActive } = req.body;
    if (isActive) {
      await InternalMarkTemplate.updateMany({}, { isActive: false });
    }
    const updated = await InternalMarkTemplate.findByIdAndUpdate(
      req.params.id,
      { templateName, columns, isActive },
      { new: true }
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete template
router.delete("/:id", async (req, res) => {
  try {
    await InternalMarkTemplate.findByIdAndDelete(req.params.id);
    res.json({ message: "Template deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
