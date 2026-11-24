// AI endpoint (Vercel serverless function).
// Only the owner (OWNER_EMAIL, signed in through Supabase) may use it, so nobody else can spend your API credit.
// Set PUBLIC_AI=true to let visitors use it too, limited to PUBLIC_AI_DAILY requests per visitor per day.
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, OWNER_EMAIL, optional AI_MODEL, PUBLIC_AI, PUBLIC_AI_DAILY
const hits = new Map(); // in-memory, resets when the function restarts (good enough as a brake)

async function whoIs(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token || !process.env.SUPABASE_URL) return null;
  try {
    const r = await fetch(process.env.SUPABASE_URL + "/auth/v1/user", { headers: { Authorization: "Bearer " + token, apikey: process.env.SUPABASE_ANON_KEY } });
    if (!r.ok) return null;
    return (await r.json()).email || null;
  } catch { return null; }
}
function publicAllowed(req, count) {
  if (process.env.PUBLIC_AI !== "true") return false;
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const key = ip + ":" + new Date().toISOString().slice(0, 10);
  const n = hits.get(key) || 0;
  if (count) hits.set(key, n + 1);
  return n < Number(process.env.PUBLIC_AI_DAILY || 10);
}

export default async function handler(req, res) {
  const email = await whoIs(req);
  const owner = !!email && email.toLowerCase() === String(process.env.OWNER_EMAIL || "").toLowerCase();
  if (req.method === "GET") return res.status(200).json({ allowed: owner || publicAllowed(req, false), owner });
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (!owner && !publicAllowed(req, true)) return res.status(owner ? 429 : 403).json({ error: "not_granted" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set in Vercel" });

  const { prompt, maxTokens, tier } = req.body || {};
  if (typeof prompt !== "string" || !prompt.trim()) return res.status(400).json({ error: "prompt missing" });
  if (prompt.length > (owner ? 400000 : 60000)) return res.status(413).json({ error: "prompt too long" });

  const model = tier === "quick" ? (process.env.AI_MODEL_QUICK || "claude-haiku-5-5") : (process.env.AI_MODEL || "claude-sonnet-5-5");
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { ...(/^sk-ant-api/.test(process.env.ANTHROPIC_API_KEY) ? { "x-api-key": process.env.ANTHROPIC_API_KEY } : { authorization: "Bearer " + process.env.ANTHROPIC_API_KEY }), "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: Math.min(Number(maxTokens) || 4000, owner ? 8000 : 2000), messages: [{ role: "user", content: prompt }] })
    });
    const j = await r.json();
    if (!r.ok) return res.status(r.status === 429 ? 429 : 502).json({ error: j?.error?.message || "AI request failed" });
    const text = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("");
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(502).json({ error: "AI request failed" });
  }
}
