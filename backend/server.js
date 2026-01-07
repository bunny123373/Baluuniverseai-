require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5000;

/* ================= MIDDLEWARE ================= */
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* ================= MONGODB ================= */
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB error:", err));

/* ================= SCHEMAS ================= */
const MovieSchema = new mongoose.Schema({
  title:String,
  category:String,
  description:String,
  poster:String,
  video:String,
  createdAt:{type:Date,default:Date.now}
});

const SeriesSchema = new mongoose.Schema({
  title:String,
  description:String,
  episodes:[
    {
      video:String,
      createdAt:{type:Date,default:Date.now}
    }
  ],
  createdAt:{type:Date,default:Date.now}
});

const Movie = mongoose.model("Movie", MovieSchema);
const Series = mongoose.model("Series", SeriesSchema);

/* ================= MULTER ================= */
const storage = multer.diskStorage({
  destination:(req,file,cb)=>{
    if(file.mimetype.startsWith("image")) cb(null,"uploads/posters");
    else cb(null,"uploads/videos");
  },
  filename:(req,file,cb)=>{
    cb(null,Date.now()+"-"+file.originalname);
  }
});
const upload = multer({storage});

/* ================= MOVIES ================= */
// Upload movie
app.post("/upload",
  upload.fields([{name:"poster"},{name:"video"}]),
  async (req,res)=>{
    const movie = new Movie({
      title:req.body.title,
      category:req.body.category,
      description:req.body.description,
      poster:req.files.poster[0].path.replace(/\\/g,"/"),
      video:req.files.video[0].path.replace(/\\/g,"/")
    });
    await movie.save();
    res.json({success:true});
  }
);

// Get movies
app.get("/movies", async(req,res)=>{
  res.json(await Movie.find().sort({createdAt:-1}));
});

// Delete movie
app.delete("/movies/:id", async(req,res)=>{
  await Movie.findByIdAndDelete(req.params.id);
  res.json({success:true});
});

/* ================= SERIES ================= */
// Create series
app.post("/series", async(req,res)=>{
  const s = new Series({
    title:req.body.title,
    description:req.body.description,
    episodes:[]
  });
  await s.save();
  res.json({success:true});
});

// Get series
app.get("/series", async(req,res)=>{
  res.json(await Series.find().sort({createdAt:-1}));
});

// Upload episode
app.post("/series/:id/episode",
  upload.single("video"),
  async(req,res)=>{
    await Series.findByIdAndUpdate(req.params.id,{
      $push:{episodes:{video:req.file.path.replace(/\\/g,"/")}}
    });
    res.json({success:true});
  }
);

// Delete episode
app.delete("/series/:sid/episode/:index", async(req,res)=>{
  const s = await Series.findById(req.params.sid);
  s.episodes.splice(req.params.index,1);
  await s.save();
  res.json({success:true});
});

/* ================= VIDEO STREAM ================= */
app.get("/video",(req,res)=>{
  const videoPath=req.query.path;
  const fullPath=path.join(__dirname,videoPath);
  if(!fs.existsSync(fullPath)) return res.sendStatus(404);

  const stat=fs.statSync(fullPath);
  const fileSize=stat.size;
  const range=req.headers.range;

  if(range){
    const parts=range.replace(/bytes=/,"").split("-");
    const start=parseInt(parts[0],10);
    const end=parts[1]?parseInt(parts[1],10):fileSize-1;
    const chunkSize=end-start+1;

    res.writeHead(206,{
      "Content-Range":`bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges":"bytes",
      "Content-Length":chunkSize,
      "Content-Type":"video/mp4"
    });
    fs.createReadStream(fullPath,{start,end}).pipe(res);
  }else{
    res.writeHead(200,{
      "Content-Length":fileSize,
      "Content-Type":"video/mp4"
    });
    fs.createReadStream(fullPath).pipe(res);
  }
});

/* ================= START ================= */
app.listen(PORT,()=>console.log(`🔥 Server running http://localhost:${PORT}`));
