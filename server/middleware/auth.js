const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Every request reads its user; a page load sends a dozen at once, so the row is kept briefly.
const USER_TTL_MS = 30_000;
const users = new Map();   // id → { at, promise }
function loadUser(id) {
  const hit = users.get(id);
  if (hit && Date.now() - hit.at < USER_TTL_MS) return hit.promise;
  const promise = User.findById(id).select('-password').lean().exec();
  users.set(id, { at: Date.now(), promise });
  promise.then(u => { if (!u) users.delete(id); }, () => users.delete(id));
  if (users.size > 1000) users.delete(users.keys().next().value);
  return promise;
}

const protect = async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  const token = auth.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await loadUser(String(decoded.id));
    if (!user) {
      return res.status(401).json({ message: 'Not authorized, user not found' });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: 'Not authorized, token failed' });
  }
};

// A changed profile must not be served from the cache.
const forgetUser = (id) => users.delete(String(id));

module.exports = { protect, forgetUser };
