const mongoose = require("mongoose");
mongoose.connect("mongodb://127.0.0.1:27017/resultDB").then(async () => {
  const db = mongoose.connection.db;
  const classes = await db.collection("classes").find({}).toArray();
  classes.forEach(cls => {
    console.log("=== CLASS:", cls.className, "===");
    console.log("subjects:", JSON.stringify(cls.subjects));
    console.log("courseDetails:", JSON.stringify(cls.courseDetails));
  });
  process.exit(0);
}).catch(err => { console.error(err); process.exit(1); });
