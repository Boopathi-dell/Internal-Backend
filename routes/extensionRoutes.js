const express = require("express");
const router = express.Router();
const ExtensionRequest = require("../models/ExtensionRequest");
const Class = require("../models/Class");

// Create a new extension request
router.post("/request", async (req, res) => {
  try {
    const { classId, className, facultyName } = req.body;
    
    if (!classId || !className) {
      return res.status(400).json({ error: "classId and className are required" });
    }

    const newRequest = new ExtensionRequest({
      classId,
      className,
      facultyName
    });

    await newRequest.save();
    res.status(201).json({ message: "Extension request submitted successfully", request: newRequest });
  } catch (error) {
    console.error("Error creating extension request:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get all extension requests
router.get("/", async (req, res) => {
  try {
    const requests = await ExtensionRequest.find().sort({ requestedAt: -1 });
    res.json(requests);
  } catch (error) {
    console.error("Error fetching extension requests:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Approve an extension request
router.put("/:id/approve", async (req, res) => {
  try {
    const { id } = req.params;
    const { editingEndDate, editingEndTime } = req.body;

    if (!editingEndDate || !editingEndTime) {
      return res.status(400).json({ error: "editingEndDate and editingEndTime are required to approve" });
    }

    const request = await ExtensionRequest.findById(id);
    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    // Update the class
    const updatedClass = await Class.findByIdAndUpdate(
      request.classId,
      { editingEndDate, editingEndTime },
      { new: true }
    );

    if (!updatedClass) {
      return res.status(404).json({ error: "Associated class not found" });
    }

    request.status = "Approved";
    await request.save();

    res.json({ message: "Request approved and class deadline updated successfully", request });
  } catch (error) {
    console.error("Error approving extension request:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Reject an extension request
router.put("/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;

    const request = await ExtensionRequest.findById(id);
    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    request.status = "Rejected";
    await request.save();

    res.json({ message: "Request rejected successfully", request });
  } catch (error) {
    console.error("Error rejecting extension request:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
