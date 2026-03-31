const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Admin = require("./models/Admin");

require("dotenv").config();
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI, {
  dbName: "resultDB",
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000,
})
  .then(async () => {
    console.log("Connected to MongoDB");

    const existing = await Admin.findOne({ email: "boopathi.mec.cse@gmail.com" });
    if (existing) {
      console.log("Admin already exists, skipping seed.");
    } else {
      const hashedPassword = await bcrypt.hash("Boopathi@1431", 10);
      await Admin.create({
        email: "boopathi.mec.cse@gmail.com",
        password: hashedPassword
      });
      console.log("✅ Admin seeded successfully!");
      console.log("   Email: boopathi.mec.cse@gmail.com");
      console.log("   Password: Boopathi@1431");
    }

    process.exit(0);
  })
  .catch(err => {
    console.error("Error:", err);
    process.exit(1);
  });
