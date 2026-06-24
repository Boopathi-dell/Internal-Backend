const express = require("express");
const router = express.Router();
const Announcement = require("../models/Announcement");
const ClassData = require("../models/Class");
const StudentSubscription = require("../models/StudentSubscription");
const jwt = require("jsonwebtoken");
const webpush = require("web-push");
const JWT_SECRET = process.env.JWT_SECRET || "mec_result_system_secret_2025";

// Setup Web Push with VAPID keys
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    "mailto:boopathimeccse@gmail.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} else {
  console.warn("WARNING: VAPID keys not configured. Push notifications will not work.");
}

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

    // Trigger Web Push Notification
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      try {
        // Find classes that match the announcement targets
        const classFilter = {
          isDeleted: { $ne: true }
        };

        if (targetProgramme && targetProgramme !== "All") classFilter.programme = targetProgramme;
        if (targetDepartment && targetDepartment !== "All") classFilter.department = targetDepartment;

        const classes = await ClassData.find(classFilter);
        
        // Filter further by year and section logic
        const filteredClasses = classes.filter(cls => {
           if (!cls.yearSemSec) return false;
           const [y, s, sec] = cls.yearSemSec.split("/");
           const yearMatch = targetYear.includes("All") || targetYear.includes(y);
           const secMatch = targetSection.includes("All") || targetSection.includes(sec);
           return yearMatch && secMatch;
        });

        // Collect all target regNos from these classes
        const targetRegNos = new Set();
        filteredClasses.forEach(cls => {
          if (cls.students) {
            cls.students.forEach(student => {
              if (student.regNo) targetRegNos.add(student.regNo);
            });
          }
        });

        if (targetRegNos.size > 0) {
          // Find all active subscriptions for these regNos
          const subscriptions = await StudentSubscription.find({ regNo: { $in: Array.from(targetRegNos) } });
          
          if (subscriptions.length > 0) {
            const payload = JSON.stringify({
              title: `📢 New ${category} Announcement`,
              body: title,
              icon: "/favicon.png",
              badge: "/favicon.png",
              url: "/"
            });

            // Send notification to all subscriptions
            const pushPromises = subscriptions.map(subDoc => 
              webpush.sendNotification(subDoc.subscription, payload).catch(err => {
                if (err.statusCode === 410 || err.statusCode === 404) {
                  // Subscription expired or invalid, remove it
                  return StudentSubscription.deleteOne({ _id: subDoc._id });
                } else {
                  console.error("Push Notification Error:", err);
                }
              })
            );

            await Promise.all(pushPromises);
            console.log(`Sent push notifications to ${subscriptions.length} devices.`);
          }
        }
      } catch (err) {
        console.error("Failed to broadcast push notification:", err);
      }
    }

    res.status(201).json(announcement);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// VAPID Public Key for Frontend
router.get("/vapid-public-key", (req, res) => {
  if (!process.env.VAPID_PUBLIC_KEY) {
    return res.status(503).json({ error: "VAPID key not configured" });
  }
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// Subscribe to push notifications (Students only)
router.post("/subscribe", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "No token provided" });
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (decoded.role !== "student") return res.status(403).json({ error: "Only students can subscribe" });

    const subscription = req.body.subscription;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: "Invalid subscription object" });
    }

    // Check if subscription exists, if not, create it
    const existing = await StudentSubscription.findOne({ regNo: decoded.regNo, "subscription.endpoint": subscription.endpoint });
    if (!existing) {
      await StudentSubscription.create({
        regNo: decoded.regNo,
        subscription
      });
    }

    res.status(201).json({ message: "Subscription saved successfully" });
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
