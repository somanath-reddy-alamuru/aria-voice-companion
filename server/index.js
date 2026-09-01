import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User, Session, Memory, Reminder, Note } from "./models.js";
import { TOOLS, runTool } from "./tools.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "aria_super_secret_jwt_key_2026";
const MAX_TOOL_ITERATIONS = 6;
const HISTORY_WINDOW = 28;

const MONGODB_URI = process.env.MONGODB_URI;
if (MONGODB_URI) {
  mongoose
    .connect(MONGODB_URI)
    .then(() => console.log("Connected to MongoDB Atlas successfully."))
    .catch((err) => console.error("MongoDB connection error:", err.message));
} else {
  console.error("⚠ MONGODB_URI is required in environment variables.");
}

async function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Access token required" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(403).json({ error: "User not found" });
    req.user = user;
    next();
  } catch (err) {
    return res.status(403).json({ error: "Invalid or expired token" });
  }
}

// FULL 10+ PROVIDERS & MODELS FAILOVER POOL
const PROVIDERS = [
  {
    id: "groq",
    envKey: "GROQ_API_KEY",
    kind: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
  },
  {
    id: "cerebras",
    envKey: "CEREBRAS_API_KEY",
    kind: "openai-compatible",
    baseUrl: "https://api.cerebras.ai/v1/chat/completions",
    models: ["llama-3.3-70b", "gpt-oss-120b"],
  },
  {
    id: "openrouter",
    envKey: "OPENROUTER_API_KEY",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    extraHeaders: { "HTTP-Referer": "https://aria-ai.app", "X-Title": "Aria AI" },
    models: ["meta-llama/llama-3.3-70b-instruct:free", "qwen/qwen3-coder:free"],
  },
  {
    id: "gemini",
    envKey: "GEMINI_API_KEY",
    kind: "gemini",
    models: ["gemini-2.5-flash", "gemini-flash-latest"],
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

function basePersonality(memoryFacts, userName) {
  const memoryBlock = memoryFacts.length
    ? `\n\nThings you know about ${userName} from past conversations:\n` + memoryFacts.map((m) => `- ${m.fact}`).join("\n")
    : "";
  return `You are Aria, a warm, emotionally intelligent voice-and-agentic companion for ${userName}. Speak naturally, warmly, and concisely.${memoryBlock}`;
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
  if (!res.ok) throw new Error(`${provider.id} API error ${res.status}`);
  const data = await res.json();
  const choice = data.choices?.[0];
  return { content: choice.message.content || null, tool_calls: choice.message.tool_calls || [] };
}

async function callGemini(provider, model, messages) {
  const systemMsg = messages.find((m) => m.role === "system");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env[provider.envKey] },
    body: JSON.stringify({
      system_instruction: systemMsg ? { parts: [{ text: systemMsg.content }] } : undefined,
      contents: messages.filter(m => m.role !== "system").map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content || "" }] })),
      generationConfig: { maxOutputTokens: 1200 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}`);
  const data = await res.json();
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text).join(" ") || "";
  return { content: text, tool_calls: [] };
}

// FAILOVER ROTATION LOGIC: Iterates through all providers/models. If one hits rate limit (429) or fails, it instantly switches to the next.
async function callAI(messages) {
  for (const provider of PROVIDERS) {
    for (const model of provider.models) {
      try {
        const message = provider.kind === "gemini" ? await callGemini(provider, model, messages) : await callOpenAICompatible(provider, model, messages);
        return { message, providerId: provider.id, model };
      } catch (err) {
        console.warn(`[ai] ${provider.id}/${model} failed (${err.message}), trying next model...`);
      }
    }
  }
  throw new Error("All configured AI providers and models failed.");
}

app.get("/health", (req, res) => res.json({ ok: true, activeProviders: PROVIDERS.map(p => p.id), db: mongoose.connection.readyState === 1 }));

// Auth Routes
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: "All fields are required" });

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: "Email already registered" });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email, passwordHash, name, avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${name}` });

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { id: user._id, email: user.email, name: user.name, avatar: user.avatar } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { id: user._id, email: user.email, name: user.name, avatar: user.avatar } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/google", async (req, res) => {
  try {
    const { email, name, avatar } = req.body;
    let user = await User.findOne({ email });
    if (!user) {
      const dummyHash = await bcrypt.hash(Math.random().toString(), 10);
      user = await User.create({ email, passwordHash: dummyHash, name, avatar: avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${name}` });
    }
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { id: user._id, email: user.email, name: user.name, avatar: user.avatar } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/auth/me", authenticateToken, (req, res) => {
  res.json({ user: { id: req.user._id, email: req.user.email, name: req.user.name, avatar: req.user.avatar } });
});

// Scoped Data Routes
app.get("/api/sessions", authenticateToken, async (req, res) => {
  const sessions = await Session.find({ userId: req.user._id }).select("title updatedAt").sort("-updatedAt");
  res.json(sessions);
});

app.get("/api/sessions/:id", authenticateToken, async (req, res) => {
  const session = await Session.findOne({ _id: req.params.id, userId: req.user._id });
  res.json(session || { messages: [] });
});

app.delete("/api/sessions/:id", authenticateToken, async (req, res) => {
  await Session.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
  res.json({ ok: true });
});

app.post("/api/chat", authenticateToken, async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: "message required" });

  const memoryFacts = await Memory.find({ userId: req.user._id });
  const systemText = basePersonality(memoryFacts, req.user.name);

  let session = sessionId ? await Session.findOne({ _id: sessionId, userId: req.user._id }) : null;
  if (!session) {
    session = await Session.create({ userId: req.user._id, title: message.substring(0, 30) + "..." });
  }

  session.messages.push({ role: "user", content: message });
  let messages = [{ role: "system", content: systemText }, ...session.messages.slice(-HISTORY_WINDOW)];
  const actions = [];

  try {
    let iterations = 0;
    let finalText = null;

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;
      const { message: msg } = await callAI(messages);
      const toolCalls = msg.tool_calls || [];
      
      if (toolCalls.length === 0) {
        finalText = msg.content || "";
        break;
      }

      messages.push({ role: "assistant", content: msg.content || null, tool_calls: toolCalls });
      session.messages.push({ role: "assistant", content: msg.content || null, tool_calls: toolCalls });

      for (const tc of toolCalls) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
        const { functionResponse, action } = await runTool(tc.function.name, args, req.user._id);
        if (action) actions.push(action);

        const toolMsg = { role: "tool", tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(functionResponse) };
        messages.push(toolMsg);
        session.messages.push(toolMsg);
      }
    }

    if (!finalText) finalText = "Done!";
    session.messages.push({ role: "assistant", content: finalText });
    session.updatedAt = Date.now();
    await session.save();

    res.json({ reply: finalText, actions, sessionId: session._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Aria Server listening on port ${PORT}`);
});