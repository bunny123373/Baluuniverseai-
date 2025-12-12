// backend/models/Video.js
const mongoose = require('mongoose');

const VideoSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  filename: { type: String, required: true }, // S3 key లేదా cloud public_id
  mimetype: { type: String, default: 'video/mp4' },
  size: { type: Number, default: 0 }, // bytes
  published: { type: Boolean, default: false }, // only published videos shown publicly
  // optional: HLS/master playlist path if using HLS
  hls_master: { type: String, default: '' },
  // optional: poster / thumbnail URL
  poster: { type: String, default: '' },
  // optional: duration in seconds (if you want)
  duration: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now }
}, {
  versionKey: false,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// update updatedAt on save
VideoSchema.pre('save', function(next){
  this.updatedAt = Date.now();
  next();
});

// simple virtual for public streaming URL placeholder (not used directly — server generates signed URLs)
VideoSchema.virtual('publicUrl').get(function(){
  // if you store direct public URL in filename you could return it here
  return '';
});

module.exports = mongoose.model('Video', VideoSchema);
