// FredTube – api/search.js  (Vercel serverless function)
// Uses Invidious + Piped public APIs – no YouTube quota, no API key needed.
// Returns the same {items:[...]} shape that app.js already expects.

// Invidious instances
const INVIDIOUS = [
  'iv.datura.network',
  'invidious.privacydev.net',
  'invidious.slipfox.xyz',
  'inv.nadeko.net',
  'invidious.lunar.icu',
  'invidious.io.lol',
];

// Piped instances (different API format, separate infrastructure)
const PIPED = [
  'pipedapi.kavin.rocks',
  'pipedapi.adminforge.de',
  'piped-api.garudalinux.org',
  'pipedapi.rivo.sh',
];

function normalizeInvidious(item) {
  const thumbs = item.videoThumbnails || [];
  const medium = thumbs.find(t => t.quality === 'medium') || thumbs[0] || {};
  const def    = thumbs.find(t => t.quality === 'default') || medium;
  const abs = u => (!u ? '' : u.startsWith('http') ? u : 'https://i.ytimg.com' + u);
  return {
    id: { videoId: item.videoId },
    snippet: {
      title:        item.title || '',
      channelTitle: item.author || '',
      thumbnails: {
        medium:  { url: abs(medium.url) },
        default: { url: abs(def.url) },
      },
    },
  };
}

function normalizePiped(item) {
  // url is like "/watch?v=VIDEO_ID"
  const videoId = (item.url || '').replace('/watch?v=', '');
  const thumb = item.thumbnail || '';
  return {
    id: { videoId },
    snippet: {
      title:        item.title || '',
      channelTitle: item.uploaderName || '',
      thumbnails: {
        medium:  { url: thumb },
        default: { url: thumb },
      },
    },
  };
}

async function fetchInvidious(host, query) {
  const path = `/api/v1/search?q=${encodeURIComponent(query)}&type=video&pretty=0`;
  const res = await fetch(`https://${host}${path}`, {
    headers: { 'User-Agent': 'FredTube/1.0' },
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('bad response');
  const videos = data.filter(i => i.type === 'video' && i.videoId).map(normalizeInvidious);
  if (!videos.length) throw new Error('no results');
  return videos;
}

async function fetchPiped(host, query) {
  const url = `https://${host}/search?q=${encodeURIComponent(query)}&filter=videos`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'FredTube/1.0' },
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const items = data.items || [];
  const videos = items.filter(i => i.type === 'stream' && i.url).map(normalizePiped);
  if (!videos.length) throw new Error('no results');
  return videos;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing query' });

  // Try Invidious instances first
  for (const host of INVIDIOUS) {
    try {
      const items = await fetchInvidious(host, q);
      return res.status(200).json({ items });
    } catch (_) { /* try next */ }
  }

  // Fall back to Piped instances (completely separate infrastructure)
  for (const host of PIPED) {
    try {
      const items = await fetchPiped(host, q);
      return res.status(200).json({ items });
    } catch (_) { /* try next */ }
  }

  res.status(502).json({ error: 'Search unavailable — all instances failed' });
}
