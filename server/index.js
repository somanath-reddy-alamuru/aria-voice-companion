import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import os from "os";
import { TOOLS, runTool } from "./tools.js";

dotenv.config();

const app = express();
app.use(cors()); // Completely open CORS to eliminate preflight or blocking errors
app.use(express.json());

const PORT = process.env.PORT || 3001;
const MAX_TOOL_ITERATIONS = 6;
const HISTORY_WINDOW = 28;

// --- MONGODB ATLAS CLOUD CONNECTION ---
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('MongoDB Atlas Connected Successfully')).catch(err => console.error('MongoDB Connection Error:', err));

// Database Schemas with OverwriteModelError protection
const conversationSchema = new mongoose.Schema({
  messages: [{
    role: { type: String, required: true },
    content: { type: String, required: true },
    tool_calls: Array,
    timestamp: { type: Date, default: Date.now }
  }],
  updatedAt: { type: Date, default: Date.now }
});
const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);

const memorySchema = new mongoose.Schema({
  fact: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const Memory = mongoose.models.Memory || mongoose.model('Memory', memorySchema);

const reminderSchema = new mongoose.Schema({
  text: { type: String, required: true },
  dueAt: { type: Date, required: true },
  delivered: { type: Boolean, default: false }
});
const Reminder = mongoose.models.Reminder || mongoose.model('Reminder', reminderSchema);

const noteSchema = new mongoose.Schema({
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const Note = mongoose.models.Note || mongoose.model('Note', noteSchema);

async function loadConversation() {
  let doc = await Conversation.findOne();
  if (!doc) {
    doc = await Conversation.create({ messages: [] });
  }
  return doc.messages;
}

async function saveConversation(messages) {
  await Conversation.findOneAndUpdate({}, { messages, updatedAt: Date.now() }, { upsert: true });
}

async function clearConversation() {
  await Conversation.findOneAndUpdate({}, { messages: [], updatedAt: Date.now() }, { upsert: true });
}

// ---------------------------------------------------------------------------
// Multi-Provider AI Failover Pool
// ---------------------------------------------------------------------------
const PROVIDERS = [
  {
    id: "groq",
    envKey: "GROQ_API_KEY",
    kind: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b", "openai/gpt-oss-20b"],
  },
  {
    id: "openrouter",
    envKey: "OPENROUTER_API_KEY",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    extraHeaders: { "HTTP-Referer": process.env.CLIENT_URL || "http://localhost:5173", "X-Title": "Aria Voice Companion" },
    models: ["openrouter/free", "meta-llama/llama-3.3-70b-instruct:free", "qwen/qwen3-coder:free"],
  },
  {
    id: "cerebras",
    envKey: "CEREBRAS_API_KEY",
    kind: "openai-compatible",
    baseUrl: "https://api.cerebras.ai/v1/chat/completions",
    models: ["llama-3.3-70b", "gpt-oss-120b"],
  },
  {
    id: "gemini",
    envKey: "GEMINI_API_KEY",
    kind: "gemini",
    models: ["gemini-2.5-flash", "gemini-3.6-flash", "gemini-flash-latest"],
  },
  {
    id: "openai",
    envKey: "OPENAI_API_KEY",
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1/chat/completions",
    models: ["gpt-4o-mini", "gpt-4o"],
  },
  {
    id: "xai",
    envKey: "XAI_API_KEY",
    kind: "openai-compatible",
    baseUrl: "https://api.x.ai/v1/chat/completions",
    models: ["grok-4-fast", "grok-3"],
  },
].filter((p) => process.env[p.envKey]);

const cooldownUntil = new Map();
const RATE_LIMIT_COOLDOWN_MS = 60_000;
const BAD_KEY_COOLDOWN_MS = 60 * 60_000;
let workingCandidate = null;

function isOnCooldown(key) {
  const until = cooldownUntil.get(key);
  return until && Date.now() < until;
}

function basePersonality(memoryFacts) {
  const memoryBlock = memoryFacts.length
    ? `\n\nThings you know about the user from past conversations:\n` + memoryFacts.map((m) => `- ${m.fact}`).join("\n")
    : "";
  return `You are Aria, a warm, emotionally intelligent voice-and-agentic companion for a college student (final-year CS, targeting software placements). You have four jobs:
1) Be a genuine conversational partner — casual chat, encouragement, thinking out loud.
2) On request, run realistic HR/behavioral mock-interview practice: ask one question at a time, listen to the answer, then give short, specific feedback.
3) Act as an agent: when the user asks you to open websites, search, check weather, time, notes, reminders, calculations, or tools, execute them accurately.
4) Keep replies concise (2-5 sentences) unless asked for depth. Speak naturally with contractions, no bullet points or markdown syntax.${memoryBlock}`;
}

async function callOpenAICompatible(provider, model, messages) {
  const res = await fetch(provider.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env[provider.envKey]}`,
      ...(provider.extraHeaders || {}),
    },
    body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: "auto", max_tokens: 700, temperature: 0.7 }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const err = new Error(errBody.error?.message || `${provider.id} API error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const choice = data.choices?.[0];
  if (!choice) throw Object.assign(new Error(`${provider.id} returned no choices`), { status: 502 });
  return { content: choice.message.content || null, tool_calls: choice.message.tool_calls || [] };
}

function toGeminiSchema(schema) {
  if (!schema || typeof schema !== "object") return schema;
  const out = { ...schema };
  if (typeof out.type === "string") out.type = out.type.toUpperCase();
  if (out.properties) {
    out.properties = Object.fromEntries(Object.entries(out.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
  }
  return out;
}

function toGeminiFunctionDecls() {
  return TOOLS.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    parameters: toGeminiSchema(t.function.parameters),
  }));
}

function toGeminiContents(messages) {
  const toolNameByCallId = {};
  messages.forEach((m) => (m.tool_calls || []).forEach((tc) => (toolNameByCallId[tc.id] = tc.function.name)));

  const contents = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "system") continue;
    if (m.role === "user") {
      contents.push({ role: "user", parts: [{ text: m.content || "" }] });
    } else if (m.role === "assistant") {
      const parts = [];
      if (m.content) parts.push({ text: m.content });
      (m.tool_calls || []).forEach((tc) => {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
        parts.push({ functionCall: { name: tc.function.name, args } });
      });
      contents.push({ role: "model", parts });
    } else if (m.role === "tool") {
      const parts = [];
      while (i < messages.length && messages[i].role === "tool") {
        const tm = messages[i];
        let respObj;
        try { respObj = JSON.parse(tm.content); } catch { respObj = { result: tm.content }; }
        parts.push({ functionResponse: { name: tm.name || toolNameByCallId[tm.tool_call_id] || "unknown_tool", response: respObj } });
        i++;
      }
      i--;
      contents.push({ role: "user", parts });
    }
  }
  return contents;
}

async function callGemini(provider, model, messages) {
  const systemMsg = messages.find((m) => m.role === "system");
  const contents = toGeminiContents(messages);
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env[provider.envKey] },
    body: JSON.stringify({
      system_instruction: systemMsg ? { parts: [{ text: systemMsg.content }] } : undefined,
      contents,
      tools: [{ functionDeclarations: toGeminiFunctionDecls() }],
      generationConfig: { maxOutputTokens: 700 },
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    const err = new Error(`gemini API error ${res.status}: ${errText.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate) throw Object.assign(new Error("gemini returned no candidates"), { status: 502 });
  const parts = candidate.content?.parts || [];
  const text = parts.filter((p) => p.text).map((p) => p.text).join(" ").trim();
  const toolCalls = parts
    .filter((p) => p.functionCall)
    .map((p, idx) => ({
      id: p.functionCall.id || `gemini_${Date.now()}_${idx}`,
      type: "function",
      function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) },
    }));
  return { content: text || null, tool_calls: toolCalls };
}

async function callModel(provider, model, messages) {
  if (provider.kind === "gemini") return callGemini(provider, model, messages);
  return callOpenAICompatible(provider, model, messages);
}

function classifyFailure(err) {
  if (err.status === 429) return { cooldownMs: RATE_LIMIT_COOLDOWN_MS, label: "rate-limited" };
  if (err.status === 401 || err.status === 403) return { cooldownMs: BAD_KEY_COOLDOWN_MS, label: "auth error" };
  if (err.status === 404 || (err.status === 400 && /not found|does not exist/i.test(err.message))) {
    return { cooldownMs: BAD_KEY_COOLDOWN_MS, label: "model unavailable" };
  }
  return { cooldownMs: RATE_LIMIT_COOLDOWN_MS, label: "error" };
}

function buildCandidateOrder() {
  const all = [];
  for (const provider of PROVIDERS) {
    for (const model of provider.models) all.push({ provider, model, key: `${provider.id}:${model}` });
  }
  const cachedFirst = workingCandidate && !isOnCooldown(workingCandidate.key)
    ? [workingCandidate, ...all.filter((c) => c.key !== workingCandidate.key)]
    : all;
  return [...cachedFirst.filter((c) => !isOnCooldown(c.key)), ...cachedFirst.filter((c) => isOnCooldown(c.key))];
}

async function callAI(messages) {
  const order = buildCandidateOrder();
  if (order.length === 0) throw Object.assign(new Error("No AI provider is configured."), { status: 500 });
  let lastErr;
  for (const cand of order) {
    try {
      const message = await callModel(cand.provider, cand.model, messages);
      workingCandidate = cand;
      cooldownUntil.delete(cand.key);
      return { message, providerId: cand.provider.id, model: cand.model };
    } catch (err) {
      lastErr = err;
      const { cooldownMs, label } = classifyFailure(err);
      cooldownUntil.set(cand.key, Date.now() + cooldownMs);
    }
  }
  throw lastErr || new Error("All configured AI providers failed.");
}

// API Routes
app.get("/health", (req, res) =>
  res.json({
    ok: true,
    configuredProviders: PROVIDERS.map((p) => p.id),
    lastUsed: workingCandidate ? `${workingCandidate.provider.id}/${workingCandidate.model}` : null,
  })
);

app.get("/api/conversation", async (req, res) => {
  res.json({ messages: await loadConversation() });
});

app.post("/api/conversation/clear", async (req, res) => {
  await clearConversation();
  res.json({ ok: true });
});

app.get("/api/reminders/due", async (req, res) => {
  const now = new Date();
  const due = await Reminder.find({ dueAt: { $lte: now }, delivered: false });
  for (const r of due) {
    r.delivered = true;
    await r.save();
  }
  res.json({ due });
});

app.get("/api/reminders", async (req, res) => {
  const reminders = await Reminder.find({ delivered: false }).sort({ dueAt: 1 });
  res.json({ reminders });
});

app.get("/api/notes", async (req, res) => {
  const notes = await Note.find().sort({ createdAt: -1 });
  res.json({ notes });
});

app.delete("/api/notes/:id", async (req, res) => {
  await Note.findByIdAndDelete(req.params.id);
  const notes = await Note.find().sort({ createdAt: -1 });
  res.json({ notes });
});

app.delete("/api/reminders/:id", async (req, res) => {
  await Reminder.findByIdAndDelete(req.params.id);
  const reminders = await Reminder.find({ delivered: false }).sort({ dueAt: 1 });
  res.json({ reminders });
});

app.get("/api/memory", async (req, res) => {
  const facts = await Memory.find();
  res.json({ facts });
});

app.delete("/api/memory/:id", async (req, res) => {
  await Memory.findByIdAndDelete(req.params.id);
  const facts = await Memory.find();
  res.json({ facts });
});

app.post("/api/chat", async (req, res) => {
  if (PROVIDERS.length === 0) return res.status(500).json({ error: "No AI provider configured." });
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: "message is required" });

  const memoryFacts = await Memory.find();
  const systemText = basePersonality(memoryFacts);

  const history = await loadConversation();
  history.push({ role: "user", content: message });

  function windowedHistory(full) {
    if (full.length <= HISTORY_WINDOW) return full;
    let start = full.length - HISTORY_WINDOW;
    while (start > 0) {
      const m = full[start];
      if (m.role === "tool") { start++; continue; }
      if (m.role === "assistant" && m.tool_calls?.length) { start++; continue; }
      break;
    }
    return full.slice(start);
  }

  let messages = [{ role: "system", content: systemText }, ...windowedHistory(history)];
  const actions = [];

  try {
    let iterations = 0;
    let finalText = null;
    let lastProviderId = null;
    let lastModel = null;

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;
      const { message: msg, providerId, model } = await callAI(messages);
      lastProviderId = providerId;
      lastModel = model;

      const toolCalls = msg.tool_calls || [];
      if (toolCalls.length === 0) {
        finalText = (msg.content || "").trim();
        break;
      }

      messages.push({ role: "assistant", content: msg.content || null, tool_calls: toolCalls });

      for (const tc of toolCalls) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
        const { functionResponse, action } = await runTool(tc.function.name, args);
        
        if (tc.function.name === 'set_reminder' && args.text && args.minutes) {
          const dueAt = new Date(Date.now() + args.minutes * 60000);
          await Reminder.create({ text: args.text, dueAt });
        }
        if (tc.function.name === 'take_note' && args.text) {
          await Note.create({ text: args.text });
        }
        if (tc.function.name === 'remember_fact' && args.fact) {
          await Memory.create({ fact: args.fact });
        }

        if (action) actions.push(action);
        messages.push({ role: "tool", tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(functionResponse) });
      }
    }

    if (!finalText) finalText = "Done!";
    history.push({ role: "assistant", content: finalText });
    await saveConversation(history);

    res.json({ reply: finalText, actions, provider: lastProviderId, model: lastModel });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Aria server listening on port ${PORT}`);
});