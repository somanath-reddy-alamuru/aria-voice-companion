import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import os from "os";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { Session } from "./models.js";
import {
  loadConversation,
  saveConversation,
  clearConversation,
  loadMemory,
  deleteMemoryFact,
  getDueReminders,
  markReminderDelivered,
  getUpcomingReminders,
  deleteReminder,
  loadNotes,
  deleteNote,
} from "./store.js";
import { TOOLS, runTool } from "./tools.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const MAX_TOOL_ITERATIONS = 6;
const HISTORY_WINDOW = 28;

const LOCAL_SESSIONS_FILE = path.resolve("sessions.json");

function loadLocalSessions() {
  try {
    if (fs.existsSync(LOCAL_SESSIONS_FILE)) {
      return JSON.parse(fs.readFileSync(LOCAL_SESSIONS_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading local sessions:", e);
  }
  return [];
}

function saveLocalSessions(sessions) {
  try {
    fs.writeFileSync(LOCAL_SESSIONS_FILE, JSON.stringify(sessions, null, 2));
  } catch (e) {
    console.error("Error saving local sessions:", e);
  }
}

const MONGODB_URI = process.env.MONGODB_URI;
if (MONGODB_URI) {
  mongoose
    .connect(MONGODB_URI)
    .then(() => console.log(" Connected to MongoDB Atlas successfully."))
    .catch((err) => console.error(" MongoDB connection error:", err.message));
} else {
  console.warn("⚠ MONGODB_URI not found in server/.env — chat sessions will be stored locally in sessions.json.");
}

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
    extraHeaders: { "HTTP-Referer": "http://localhost:5173", "X-Title": "Aria Voice Companion" },
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
2) On request, run realistic HR/behavioral mock-interview practice: ask one question at a time, listen to the answer, then give short, specific feedback before the next question.
3) Act as an agent: when the user asks you to open local apps (like notepad, calculator, vs code), play something, search, check weather, set reminders, or manage notes, use your tools to execute them directly.
4) Be genuinely useful as a general-purpose assistant.
Speak the way a smart, kind friend would talk out loud. For code, format it clearly using Markdown triple backticks with the programming language specified.${memoryBlock}`;
}

async function callOpenAICompatible(provider, model, messages) {
  const res = await fetch(provider.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env[provider.envKey]}`,
      ...(provider.extraHeaders || {}),
    },
    body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: "auto", max_tokens: 1200, temperature: 0.7 }),
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
      generationConfig: { maxOutputTokens: 1200 },
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
  if (!candidate) {
    const blockReason = data.promptFeedback?.blockReason;
    throw Object.assign(new Error(blockReason ? `blocked: ${blockReason}` : "gemini returned no candidates"), { status: 502 });
  }
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
  if (err.status === 404 || (err.status === 400 && /not found|does not exist|decommission/i.test(err.message))) {
    return { cooldownMs: BAD_KEY_COOLDOWN_MS, label: "model unavailable" };
  }
  return { cooldownMs: RATE_LIMIT_COOLDOWN_MS, label: "error" };
}

function buildCandidateOrder() {
  const all = [];
  for (const provider of PROVIDERS) {
    for (const model of provider.models) all.push({ provider, model, key: `${provider.id}:${model}` });
  }
  const cachedFirst =
    workingCandidate && !isOnCooldown(workingCandidate.key)
      ? [workingCandidate, ...all.filter((c) => c.key !== workingCandidate.key)]
      : all;
  const fresh = cachedFirst.filter((c) => !isOnCooldown(c.key));
  const stale = cachedFirst.filter((c) => isOnCooldown(c.key));
  return [...fresh, ...stale];
}

async function callAI(messages) {
  const order = buildCandidateOrder();
  if (order.length === 0) {
    throw Object.assign(new Error("No AI provider configured in server/.env"), { status: 500 });
  }
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
      console.warn(`[ai] ${cand.key} ${label} (${err.status}: ${err.message}) — trying next candidate`);
      if (workingCandidate?.key === cand.key) workingCandidate = null;
    }
  }
  throw lastErr || new Error("All configured AI providers failed.");
}

app.get("/health", (req, res) =>
  res.json({
    ok: true,
    configuredProviders: PROVIDERS.map((p) => p.id),
    lastUsed: workingCandidate ? `${workingCandidate.provider.id}/${workingCandidate.model}` : null,
    dbConnected: mongoose.connection.readyState === 1,
  })
);

app.get("/api/sessions", async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      const sessions = await Session.find().select("title updatedAt").sort("-updatedAt");
      return res.json(sessions);
    } else {
      const local = loadLocalSessions().map(s => ({ _id: s._id, title: s.title, updatedAt: s.updatedAt })).sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      return res.json(local);
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch sessions" });
  }
});

app.get("/api/sessions/:id", async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      const session = await Session.findById(req.params.id);
      return res.json(session);
    } else {
      const local = loadLocalSessions();
      const session = local.find(s => s._id === req.params.id);
      return res.json(session || { _id: req.params.id, title: "Chat", messages: [] });
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch session" });
  }
});

app.delete("/api/sessions/:id", async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      await Session.findByIdAndDelete(req.params.id);
      return res.json({ ok: true });
    } else {
      let local = loadLocalSessions();
      local = local.filter(s => s._id !== req.params.id);
      saveLocalSessions(local);
      return res.json({ ok: true });
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to delete session" });
  }
});

app.get("/api/conversation", (req, res) => {
  res.json({ messages: loadConversation() });
});

app.post("/api/conversation/clear", (req, res) => {
  clearConversation();
  res.json({ ok: true });
});

app.get("/api/reminders/due", (req, res) => {
  const due = getDueReminders();
  due.forEach((r) => markReminderDelivered(r.id));
  res.json({ due });
});

app.get("/api/reminders", (req, res) => {
  res.json({ reminders: getUpcomingReminders() });
});

app.get("/api/notes", (req, res) => {
  res.json({ notes: loadNotes() });
});

app.delete("/api/notes/:id", (req, res) => {
  const notes = deleteNote(req.params.id);
  res.json({ notes });
});

app.delete("/api/reminders/:id", (req, res) => {
  deleteReminder(req.params.id);
  res.json({ reminders: getUpcomingReminders() });
});

app.get("/api/memory", (req, res) => {
  res.json({ facts: loadMemory() });
});

app.delete("/api/memory/:id", (req, res) => {
  const facts = deleteMemoryFact(req.params.id);
  res.json({ facts });
});

app.post("/api/chat", async (req, res) => {
  if (PROVIDERS.length === 0) {
    return res.status(500).json({ error: "No AI provider is configured." });
  }
  const { message, sessionId } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: "message is required" });
  }

  const memoryFacts = loadMemory();
  const systemText = basePersonality(memoryFacts);

  let session = null;
  let localSessions = [];
  let isMongo = mongoose.connection.readyState === 1;

  if (isMongo) {
    if (sessionId) session = await Session.findById(sessionId);
    if (!session) session = new Session({ title: message.substring(0, 32) + "..." });
  } else {
    localSessions = loadLocalSessions();
    if (sessionId) session = localSessions.find(s => s._id === sessionId);
    if (!session) {
      session = { _id: Date.now().toString(), title: message.substring(0, 32) + "...", messages: [], updatedAt: Date.now() };
      localSessions.unshift(session);
    }
  }

  const history = isMongo 
    ? session.messages.map((m) => ({ role: m.role, content: m.content, tool_calls: m.tool_calls, tool_call_id: m.tool_call_id, name: m.name }))
    : session.messages;

  history.push({ role: "user", content: message });
  session.messages.push({ role: "user", content: message });

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
      session.messages.push({ role: "assistant", content: msg.content || null, tool_calls: toolCalls });

      for (const tc of toolCalls) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch { args = {}; }
        const { functionResponse, action } = await runTool(tc.function.name, args);
        if (action) actions.push(action);
        
        const toolMsg = { role: "tool", tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(functionResponse) };
        messages.push(toolMsg);
        session.messages.push(toolMsg);
      }
    }

    if (finalText === null || finalText === "") {
      finalText = "I processed that action, let me know if you need anything else!";
    }

    session.messages.push({ role: "assistant", content: finalText });
    session.updatedAt = Date.now();

    if (isMongo) {
      await session.save();
    } else {
      saveLocalSessions(localSessions);
    }

    res.json({
      reply: finalText,
      actions,
      provider: lastProviderId,
      model: lastModel,
      sessionId: session._id || session.id,
      sessionTitle: session.title,
    });
  } catch (err) {
    console.error(err);
    const friendly = err.status === 429
      ? "All configured AI providers are rate-limited right now. Please wait a moment."
      : err.message;
    res.status(500).json({ error: friendly });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Aria Server listening on http://localhost:${PORT}`);
  const lanIp = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
  if (lanIp) {
    console.log(`📱 On Mobile / LAN: set server URL to http://${lanIp}:${PORT}`);
  }
});