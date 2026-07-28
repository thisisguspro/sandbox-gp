// AI auto-translation via the Replit AI Integrations OpenAI proxy.
// Keys auto-provisioned: AI_INTEGRATIONS_OPENAI_BASE_URL + AI_INTEGRATIONS_OPENAI_API_KEY.
// Used by the admin Localization "Auto-translate" action to seed machine
// translations for a locale (human-edited rows are never touched upstream).
import OpenAI from "openai";

// Human-readable target descriptions guide tone/variant for each locale.
const LOCALE_HINTS = {
  "pt-BR": "Brazilian Portuguese (pt-BR)",
  "es-MX": "Mexican Spanish (es-MX)",
};

let _client = null;
function client() {
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!baseURL || !apiKey) {
    throw new Error("AI translation is not configured (missing OpenAI integration env vars).");
  }
  if (!_client) _client = new OpenAI({ baseURL, apiKey });
  return _client;
}

// Whether the integration is wired up (used to gate the admin endpoint).
export function translatorConfigured() {
  return !!(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY);
}

// Split into small chunks so one request never returns a huge / truncated JSON.
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function translateChunk(items, targetHint) {
  const source = {};
  for (const { key, en } of items) source[key] = en;
  const system =
    "You are a professional game-UI localizer for a western robot-cowboy hidden-traitor multiplayer game. " +
    `Translate the English UI strings into ${targetHint}. ` +
    "Return ONLY a JSON object mapping each original key to its translated string. " +
    "Rules: keep it concise and natural for on-screen UI; preserve every placeholder token EXACTLY " +
    "(e.g. {name}, {n}, {count}, %s, %d, and any {curly} or %-style tokens); do not translate placeholder tokens; " +
    "keep leading/trailing punctuation and symbols; match the tone of a rugged frontier game; " +
    "do not add explanations or extra keys.";
  const user = JSON.stringify(source);
  const resp = await client().chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 8192,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const text = resp.choices?.[0]?.message?.content || "{}";
  let parsed;
  // Throw (don't swallow) so the caller's retry/backoff re-requests this chunk
  // on a malformed / truncated JSON response instead of silently dropping it.
  try { parsed = JSON.parse(text); }
  catch { throw new Error("Translation response was not valid JSON."); }
  const pairs = [];
  for (const { key } of items) {
    const value = parsed[key];
    if (typeof value === "string" && value.trim()) pairs.push({ key, value: value.trim() });
  }
  return pairs;
}

// Translate [{key,en}] into a locale. Runs chunks with limited concurrency and
// simple retry/backoff. Returns { pairs:[{key,value}], failed:number }.
export async function translateStrings(lang, items, { chunkSize = 25, concurrency = 2, retries = 3 } = {}) {
  const targetHint = LOCALE_HINTS[lang] || lang;
  const chunks = chunk(items, chunkSize);
  const results = [];
  let failed = 0;
  let idx = 0;
  async function worker() {
    while (idx < chunks.length) {
      const my = chunks[idx++];
      let attempt = 0;
      for (;;) {
        try {
          const pairs = await translateChunk(my, targetHint);
          results.push(...pairs);
          failed += my.length - pairs.length;
          break;
        } catch (e) {
          attempt++;
          if (attempt > retries) { failed += my.length; break; }
          await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
        }
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, chunks.length || 1) }, worker);
  await Promise.all(workers);
  return { pairs: results, failed };
}
