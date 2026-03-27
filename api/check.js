module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const ids = (req.query.ids || '').split(',').filter(Boolean).slice(0, 50);
  if (!ids.length) return res.json({ available: {} });

  const available = {};
  await Promise.all(ids.map(async id => {
    try {
      const r = await fetch(
        `https://www.youtube.com/embed/${id}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow', signal: AbortSignal.timeout(8000) }
      );
      if (r.status === 404) { available[id] = false; return; }
      // 403/429/5xx are likely IP-level blocks — treat as available
      if (r.status !== 200) { available[id] = true; return; }
      const text = await r.text();
      // Embed disabled → "UNPLAYABLE"; deleted/private → "ERROR"; age-restricted → "LOGIN_REQUIRED"
      available[id] = !/"status"\s*:\s*"(?:UNPLAYABLE|ERROR|LOGIN_REQUIRED)"/.test(text);
    } catch (e) {
      available[id] = true; // network error → assume available
    }
  }));

  return res.json({ available });
};
