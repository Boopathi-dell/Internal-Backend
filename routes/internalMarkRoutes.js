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
    const regulation = req.query.regulation;
    const query = { isActive: true };
    if (regulation) {
      query.regulation = regulation;
    }
    const template = await InternalMarkTemplate.findOne(query);
    res.json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get shared header image
router.get("/header-image", async (req, res) => {
  try {
    const templateWithHeader = await InternalMarkTemplate.findOne({ headerImage: { $ne: "" } }).sort({ createdAt: -1 });
    res.json({ headerImage: templateWithHeader ? templateWithHeader.headerImage : "" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save shared header image
router.post("/header-image", async (req, res) => {
  try {
    const { headerImage } = req.body;
    // Update all active templates or most recent with this headerImage
    await InternalMarkTemplate.updateMany({}, { headerImage });
    res.json({ success: true, headerImage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new template
router.post("/", async (req, res) => {
  try {
    const { templateName, regulation, columns, isActive, headerImage } = req.body;
    if (isActive && regulation) {
      await InternalMarkTemplate.updateMany({ regulation }, { isActive: false });
    } else if (isActive) {
      await InternalMarkTemplate.updateMany({}, { isActive: false });
    }
    const newTemplate = new InternalMarkTemplate({ 
      templateName, 
      regulation, 
      columns, 
      isActive,
      headerImage: headerImage || ""
    });
    await newTemplate.save();
    res.json(newTemplate);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update template
router.put("/:id", async (req, res) => {
  try {
    const { templateName, regulation, columns, isActive, headerImage } = req.body;
    if (isActive && regulation) {
      await InternalMarkTemplate.updateMany({ regulation }, { isActive: false });
    } else if (isActive) {
      await InternalMarkTemplate.updateMany({}, { isActive: false });
    }
    const updated = await InternalMarkTemplate.findByIdAndUpdate(
      req.params.id,
      { templateName, regulation, columns, isActive, ...(headerImage !== undefined ? { headerImage } : {}) },
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
