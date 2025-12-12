const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  passwordHash: String,
  role: { type: String, default: 'admin' }, // admin / user
  createdAt: { type: Date, default: Date.now }
});

// helper to set password
UserSchema.methods.setPassword = async function(plain){
  const s = await bcrypt.genSalt(10);
  this.passwordHash = await bcrypt.hash(plain, s);
};

UserSchema.methods.validatePassword = async function(plain){
  return bcrypt.compare(plain, this.passwordHash);
};

module.exports = mongoose.model('User', UserSchema);