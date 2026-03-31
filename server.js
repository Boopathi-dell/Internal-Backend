require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const classRoutes = require("./routes/classRoutes");
const authRoutes = require("./routes/authRoutes");

const app = express();
app.use(cors({
  origin: "*", // allow all origins for now to prevent CORS issues on production
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));
app.use(express.json());

// Routes
app.use("/api/classes", classRoutes);
app.use("/api/auth", authRoutes);

// MongoDB connect
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("CRITICAL: MONGO_URI is not defined in environment variables!");
}

mongoose.connect(MONGO_URI, {
  dbName: "resultDB",
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000,
})
  .then(() => console.log("MongoDB Connected ✅"))
  .catch(err => {
    console.error("MongoDB Connection Error ❌:", err.message);
    process.exit(1); // stop server if DB fails
  });

// test route
app.get("/", (req, res) => {
  res.send("Server Running ✅");
});

// Keep the free tier Render server awake
const EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
if (EXTERNAL_URL) {
  setInterval(() => {
    require("https").get(EXTERNAL_URL, (resp) => {
      if (resp.statusCode === 200) console.log("Wake-up Ping Successful 🟢");
    }).on("error", (err) => {
      console.log("Ping error:", err.message);
    });
  }, 10 * 60 * 1000); // Pings every 10 minutes
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});