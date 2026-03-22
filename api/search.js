// FredTube – api/search.js  (Vercel serverless function)
// Scrapes YouTube search page directly – no API key, no quota, no third-party APIs.
// Returns the same {items:[...]} shape that app.js already expects.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing query' });

  try {
    const items = await searchYouTube(q);
    return res.status(200).json({ items });
  } catch (err) {
    console.error('YouTube search error:', err.message);
    return res.status(502).json({ error: 'Search unavailable: ' + err.message });
  }
}

async function searchYouTube(query) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%3D%3D`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) throw new Error(`YouTube returned HTTP ${res.status}`);

  const html = await res.text();

  // Extract the embedded JSON data
  const marker = 'var ytInitialData = ';
  const start = html.indexOf(marker);
  if (start === -1) throw new Error('ytInitialData not found in page');

  const jsonStart = start + marker.length;
  // Find the closing }; by scanning for the script end tag
  const scriptEnd = html.indexOf(';</script>', jsonStart);
  if (scriptEnd === -1) throw new Error('Could not find end of ytInitialData');

  let data;
  try {
    data = JSON.parse(html.slice(jsonStart, scriptEnd));
  } catch (e) {
    throw new Error('Failed to parse ytInitialData JSON');
  }

  // Navigate the YouTube data structure to find video results
  const sectionList =
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
  if (!sectionList) throw new Error('Unexpected YouTube page structure');

  const items = [];
  for (const section of sectionList) {
    const sectionContents = section?.itemSectionRenderer?.contents;
    if (!sectionContents) continue;
    for (const item of sectionContents) {
      const vr = item?.videoRenderer;
      if (!vr?.videoId) continue;

      const title = vr.title?.runs?.[0]?.text || vr.title?.simpleText || '';
      const channel = vr.ownerText?.runs?.[0]?.text || vr.shortBylineText?.runs?.[0]?.text || '';
      const thumbs = vr.thumbnail?.thumbnails || [];
      // Pick largest thumbnail
      const thumb = thumbs[thumbs.length - 1]?.url || '';
      // Also get a medium-sized one if available
      const medThumb = thumbs[Math.min(1, thumbs.length - 1)]?.url || thumb;

      items.push({
        id: { videoId: vr.videoId },
        snippet: {
          title,
          channelTitle: channel,
          thumbnails: {
            medium:  { url: medThumb },
            default: { url: thumb },
          },
        },
      });
    }
  }

  if (!items.length) throw new Error('No video results found');
  return items;
}
