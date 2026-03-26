module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const ids = (req.query.ids || '').split(',').filter(Boolean).slice(0, 50);
  if (!ids.length) return res.json({ available: {} });

  const available = {};
  await Promise.all(ids.map(async id => {
    try {
      const r = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' }
      );
      // Only mark unavailable on a definitive 404 (deleted/private).
      // 403/429/5xx are likely IP-level blocks - treat as available.
      available[id] = r.status !== 404;
    } catch (e) {
      available[id] = true; // network error -> assume available
    }
  }));

  return res.json({ available });
};
