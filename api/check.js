export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const ids = (req.query.ids || '').split(',').filter(Boolean).slice(0, 50);
  if (!ids.length) return res.json({ available: {} });

  const available = {};
  await Promise.all(ids.map(async id => {
    try {
      const r = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      available[id] = r.ok;
    } catch (e) {
      available[id] = false;
    }
  }));

  return res.json({ available });
}
