const express = require("express");
const router = express.Router();
const InternalMarkTemplate = require("../models/InternalMarkTemplate");

// Get all templates
router.get("/", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const templates = await InternalMarkTemplate.find().sort({ createdAt: -1 });
    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const normalizeCategory = (val) => (val === "Lab" ? "Lab" : "Theory");

const normalizeOrientation = (val, category) => {
  if (val === "portrait" || val === "landscape") return val;
  return category === "Lab" ? "portrait" : "landscape";
};

const buildCategoryFilter = (category) => {
  if (category === "Lab") {
    return { courseCategory: "Lab" };
  }
  return {
    $or: [
      { courseCategory: "Theory" },
      { courseCategory: { $exists: false } },
      { courseCategory: null },
      { courseCategory: "" }
    ]
  };
};

// Deactivate sibling templates only within the same (regulation + courseCategory) slot so Theory and Lab can both remain Active
const deactivateSiblingTemplates = async (isActive, regulation, courseCategory, excludeId = null) => {
  if (!isActive) return;
  const filter = {
    ...(regulation ? { regulation } : {}),
    ...buildCategoryFilter(courseCategory),
    ...(excludeId ? { _id: { $ne: excludeId } } : {})
  };
  await InternalMarkTemplate.updateMany(filter, { isActive: false });
};

// Get active template (optionally filtered by regulation and category: Theory | Lab)
router.get("/active", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const { regulation, category } = req.query;
    const query = { isActive: true };
    if (regulation) {
      query.regulation = regulation;
    }
    if (category) {
      Object.assign(query, buildCategoryFilter(normalizeCategory(category)));
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

const normalizePassMark = (val) => {
  if (val === undefined || val === null || val === "") return 0;
  const n = Number(val);
  return isNaN(n) || n < 0 ? 0 : n;
};

// Create new template
router.post("/", async (req, res) => {
  try {
    const { templateName, regulation, courseCategory, printOrientation, passMark, columns, isActive, headerImage } = req.body;
    const category = normalizeCategory(courseCategory);
    const orientation = normalizeOrientation(printOrientation, category);

    await deactivateSiblingTemplates(isActive, regulation, category);

    const newTemplate = new InternalMarkTemplate({ 
      templateName, 
      regulation,
      courseCategory: category,
      printOrientation: orientation,
      passMark: normalizePassMark(passMark),
      columns, 
      isActive,
      headerImage: headerImage || "",
      updatedAt: new Date()
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
    const { templateName, regulation, courseCategory, printOrientation, passMark, columns, isActive, headerImage } = req.body;
    const category = normalizeCategory(courseCategory);
    const orientation = normalizeOrientation(printOrientation, category);

    await deactivateSiblingTemplates(isActive, regulation, category, req.params.id);

    const updateDoc = {
      templateName,
      regulation,
      courseCategory: category,
      printOrientation: orientation,
      columns,
      isActive,
      updatedAt: new Date(),
      ...(passMark !== undefined ? { passMark: normalizePassMark(passMark) } : {}),
      ...(headerImage !== undefined ? { headerImage } : {})
    };
    const updated = await InternalMarkTemplate.findByIdAndUpdate(
      req.params.id,
      updateDoc,
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
