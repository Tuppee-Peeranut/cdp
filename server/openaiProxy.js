export default async function openaiProxy(req, res) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing API key' });
  }
  // Basic guard against misconfigured key (e.g., Supabase JWT accidentally set)
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(apiKey) || apiKey.length < 20) {
    return res.status(401).json({ error: { message: 'OPENAI_API_KEY appears invalid. Set a real OpenAI key (sk-...)', code: 'invalid_api_key' } });
  }
  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
