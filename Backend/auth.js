const jwt = require('jsonwebtoken');
const User = require('./models/User');
const JWT_SECRET = process.env.JWT_SECRET || 'change_this';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// register (one-time) - protect this route or call from console
app.post('/api/auth/register', async (req,res)=>{
  try {
    const { username, password } = req.body;
    if(!username || !password) return res.status(400).json({ error:'username/password required' });
    const u = new User({ username });
    await u.setPassword(password);
    await u.save();
    res.json({ success:true });
  } catch(err){ console.error(err); res.status(500).json({ error:'server error' }); }
});

// login
app.post('/api/auth/login', async (req,res)=>{
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if(!user) return res.status(401).json({ error: 'invalid' });
    const ok = await user.validatePassword(password);
    if(!ok) return res.status(401).json({ error: 'invalid' });
    const token = jwt.sign({ sub: user._id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({ token });
  } catch(err){ console.error(err); res.status(500).json({ error:'server error' }); }
});

// middleware to protect routes (replace adminAuth)
function jwtAuth(req,res,next){
  const auth = req.headers['authorization'];
  if(!auth) return res.status(401).json({ error:'no auth' });
  const parts = auth.split(' ');
  if(parts.length!==2) return res.status(401).json({ error:'invalid token' });
  const token = parts[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch(e){ return res.status(401).json({ error:'invalid token' }); }
}