export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing query parameter q' });

  const key = process.env.YT_API_KEY;
  if (!key) return res.status(500).json({ error: 'API key not configured' });

  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('videoCategoryId', '10');
  url.searchParams.set('q', q);
  url.searchParams.set('maxResults', '20');
  url.searchParams.set('key', key);

  try {
    const response = await fetch(url.toString());
    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch from YouTube API' });
  }
}
