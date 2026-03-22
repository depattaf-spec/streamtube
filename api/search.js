// FredTube — api/search.js  (Vercel serverless function)
// Uses Invidious public API — no YouTube quota, no API key needed.
// Returns the same {items:[...]} shape that app.js already expects.

const INSTANCES = [
  'inv.tux.pizza',
  'invidious.privacydev.net',
  'yt.artemislena.eu',
  'invidious.nerdvpn.de',
  'invidious.flokinet.to',
  'invidious.io.lol',
];

function normalize(item) {
  const thumbs = item.videoThumbnails || [];
  const medium  = thumbs.find(t => t.quality === 'medium')  || thumbs[0] || {};
  const def     = thumbs.find(t => t.quality === 'default') || medium;
  const abs = u => (!u ? '' : u.startsWith('http') ? u : 'https://i.ytimg.com' + u);
  return {
    id: { videoId: item.videoId },
    snippet: {
      title:        item.title  || '',
      channelTitle: item.author || '',
      thumbnails: {
        medium:  { url: abs(medium.url) },
        default: { url: abs(def.url)    },
      },
    },
  };
}

async function fetchInstance(host, query) {
  const path = '/api/v1/search?q=' + encodeURIComponent(query) + '&type=video&pretty=0';
  const res  = await fetch('https://' + host + path, {
    headers: { 'User-Agent': 'FredTube/1.0' },
    signal:  AbortSignal.timeout(6000),
  });
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('bad response');
  return data.filter(i => i.type === 'video' && i.videoId).map(normalize);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing query' });

  for (const host of INSTANCES) {
    try {
      const items = await fetchInstance(host, q);
      return res.status(200).json({ items });
    } catch (_) { /* try next instance */ }
  }
  res.status(502).json({ error: 'Search unavailable — all Invidious instances failed' });
}
