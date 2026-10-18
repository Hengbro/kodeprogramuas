// Pembatas laju sederhana berbasis memori (per alamat IP).
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    let entry = hits.get(key);
    if (!entry || entry.reset < now) { entry = { count: 0, reset: now + windowMs }; hits.set(key, entry); }
    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).render('error', { title: 'Terlalu banyak percobaan', message: 'Silakan coba lagi beberapa menit lagi.' });
    }
    next();
  };
}
module.exports = { rateLimit };
