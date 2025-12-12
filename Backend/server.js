// ===============================
// BALUPLIX SERVER (TELUGU VERSION)
// ===============================
// Features:
// 1. Admin → Presigned Upload URL (S3) తీసుకుంటాడు
// 2. Admin → Video ఫైల్‌ను S3 కి direct upload చేస్తాడు
// 3. Server → MongoDB Atlas లో metadata save చేస్తుంది
// 4. Server → Signed GET URLs ఇచ్చి వీడియోని stream చేస్తుంది
// 5. Admin → Publish/Unpublish చేయగలడు
// 6. Public → Published వీడియోలు మాత్రమే చూడగలరు

require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");
const cors = require("cors");
const Video = require("./models/Video");

// AWS SDK for S3
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand
} = require("@aws-sdk/client-s3");

const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const app = express();
app.use(cors());
app.use(express.json());

// ------------------------------
// ENV VARIABLES
// ------------------------------
const {
  PORT,
  MONGO_URI,
  ADMIN_TOKEN,
  AWS_REGION,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  S3_BUCKET
} = process.env;

if (!MONGO_URI) {
  console.error("❌ MONGO_URI లేదు (.env లో పెట్టాలి)");
  process.exit(1);
}

// ------------------------------
// MONGO CONNECT
// ------------------------------
mongoose
  .connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => {
    console.error("❌ MongoDB Error:", err);
    process.exit(1);
  });

// ------------------------------
// AWS S3 CLIENT
// ------------------------------
const s3 = new S3Client({
  region: AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
});

// ------------------------------
// ADMIN AUTH MIDDLEWARE
// ------------------------------
function adminAuth(req, res, next) {
  const token = req.headers["x-admin-token"] || req.body.adminToken;
  if (!token || token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized (Admin only)" });
  }
  next();
}

// ===============================
// API 1: PRESIGNED URL FOR UPLOAD
// ===============================
app.post("/api/upload-url", adminAuth, async (req, res) => {
  try {
    const { filename, contentType } = req.body;
    if (!filename || !contentType) {
      return res.status(400).json({ error: "filename మరియు contentType కావాలి" });
    }

    // Unique key generate
    const randomId = crypto.randomBytes(8).toString("hex");
    const key = `videos/${Date.now()}-${randomId}-${filename}`;

    // PUT ఆదేశం (file upload)
    const putCommand = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: contentType,
      ACL: "private", // public చేయాలంటే "public-read"
    });

    // 15 minutes valid presigned URL
    const uploadUrl = await getSignedUrl(s3, putCommand, { expiresIn: 900 });

    return res.json({ uploadUrl, key });
  } catch (error) {
    console.error("UPLOAD URL ERROR:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// ===============================
// API 2: SAVE VIDEO METADATA
// ===============================
app.post("/api/videos", adminAuth, async (req, res) => {
  try {
    const { title, description, key, size, mimetype } = req.body;

    if (!key || !title) {
      return res.status(400).json({ error: "title మరియు key కావాలి" });
    }

    const video = new Video({
      title,
      description,
      filename: key,
      size,
      mimetype,
      published: false,
    });

    await video.save();
    return res.json({ success: true, video });
  } catch (error) {
    console.error("METADATA ERROR:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// ===============================
// API 3: GET PUBLIC PUBLISHED VIDEOS
// ===============================
app.get("/api/videos", async (req, res) => {
  try {
    const videos = await Video.find({ published: true }).sort({ createdAt: -1 });

    // ప్రతి వీడియోకి signed GET URL తయారు చెయ్యాలి
    const results = [];

    for (const v of videos) {
      const getCmd = new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: v.filename,
      });

      // 1 hour valid signed streaming URL
      const signedUrl = await getSignedUrl(s3, getCmd, { expiresIn: 3600 });

      results.push({
        _id: v._id,
        title: v.title,
        description: v.description,
        createdAt: v.createdAt,
        size: v.size,
        url: signedUrl,
      });
    }

    return res.json(results);
  } catch (error) {
    console.error("PUBLIC VIDEO ERROR:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// ===============================
// API 4: ADMIN - LIST ALL VIDEOS
// ===============================
app.get("/api/admin/videos", adminAuth, async (req, res) => {
  const videos = await Video.find().sort({ createdAt: -1 });
  res.json(videos);
});

// ===============================
// API 5: PUBLISH / UNPUBLISH
// ===============================
app.post("/api/video/:id/publish", adminAuth, async (req, res) => {
  try {
    const { publish } = req.body;
    const video = await Video.findByIdAndUpdate(
      req.params.id,
      { published: !!publish },
      { new: true }
    );

    if (!video) return res.status(404).json({ error: "Video not found" });

    return res.json({ success: true, video });
  } catch (error) {
    console.error("PUBLISH ERROR:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// ===============================
// API 6: DELETE VIDEO
// ===============================
app.delete("/api/admin/video/:id", adminAuth, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);

    if (!video) return res.status(404).json({ error: "Video not found" });

    // S3 నుండి ఫైల్ కూడా delete చేయాలి
    const deleteCmd = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: video.filename,
    });

    try {
      await s3.send(deleteCmd);
    } catch (err) {
      console.warn("S3 delete skipped:", err.message);
    }

    await Video.deleteOne({ _id: video._id });

    return res.json({ success: true });
  } catch (error) {
    console.error("DELETE ERROR:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// ===============================
// START SERVER
// ===============================
const port = PORT || 10000;
app.listen(port, () => {
  console.log(`🚀 BALUPLIX SERVER RUNNING ON PORT ${port}`);
});