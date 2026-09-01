import { useEffect, useRef, useState } from "react";
import NeuronField from "./NeuronField.jsx";

const SERVER_URL_KEY = "aria_server_url";
function defaultApiBase() {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  const h = typeof window !== "undefined" ? window.location.hostname : "";
  if (h === "localhost" || h === "127.0.0.1") return "http://localhost:3001";
  return "";
}
function getApiBase() {
  if (typeof window === "undefined") return defaultApiBase();
  return localStorage.getItem(SERVER_URL_KEY) || defaultApiBase();
}
function setApiBase(url) {
  const clean = url.trim().replace(/\/+$/, "");
  if (clean) localStorage.setItem(SERVER_URL_KEY, clean);
  else localStorage.removeItem(SERVER_URL_KEY);
}

const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

const SITE_MAP = {
  youtube: "https://www.youtube.com",
  gmail: "https://mail.google.com",
  google: "https://www.google.com",
  maps: "https://maps.google.com",
  "google maps": "https://maps.google.com",
  drive: "https://drive.google.com",
  github: "https://github.com",
  linkedin: "https://linkedin.com",
  leetcode: "https://leetcode.com",
  chatgpt: "https://chat.openai.com",
  spotify: "https://open.spotify.com",
  amazon: "https://amazon.in",
  whatsapp: "https://wa.me/",
  instagram: "https://instagram.com",
  twitter: "https://x.com",
  discord: "https://discord.com/app",
  notion: "https://notion.so",
  zoom: "https://zoom.us/join",
};

function tryOfflineCommand(raw) {
  const text = raw.toLowerCase().trim();
  let m = text.match(/^(?:open|launch|go to|start)\s+(.+)/);
  if (m) {
    let target = m[1].replace(/[.?!]+$/, "").trim();
    if (/\bplay\b/.test(target)) return null;
    if (SITE_MAP[target]) {
      const r = openTab(SITE_MAP[target]);
      return r.blocked ? blockedMsg(r.url) : `Opening ${target}.`;
    }
    if (/^[\w-]+\.[a-z]{2,}$/i.test(target)) {
      const r = openTab("https://" + target);
      return r.blocked ? blockedMsg(r.url) : `Opening ${target}.`;
    }
    const r = openTab("https://www.google.com/search?q=" + encodeURIComponent(target));
    return r.blocked ? blockedMsg(r.url) : `Searched Google for "${target}".`;
  }

  m = text.match(/^search (?:google|the web) for (.+)/);
  if (m) {
    const r = openTab("https://www.google.com/search?q=" + encodeURIComponent(m[1]));
    return r.blocked ? blockedMsg(r.url) : `Here's what I found for "${m[1]}".`;
  }
  return null;
}

function blockedMsg(url) {
  return `Browser blocked popup. Tap to open: ${url}`;
}

function openTab(url) {
  const win = window.open(url, "_blank");
  if (!win || win.closed || typeof win.closed === "undefined") {
    return { blocked: true, url };
  }
  return { blocked: false, url };
}

function linkify(text) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline text-cyan-400">
        {part}
      </a>
    ) : (
      part
    )
  );
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [state, setState] = useState("idle");
  const [wakeOn, setWakeOn] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState("reminders");
  const [reminders, setReminders] = useState([]);
  const [notes, setNotes] = useState([]);
  const [memoryFacts, setMemoryFacts] = useState([]);
  const [activeProvider, setActiveProvider] = useState(null);
  const [configuredProviders, setConfiguredProviders] = useState([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState(getApiBase());
  const [connected, setConnected] = useState(null);

  const recognitionRef = useRef(null);
  const continuousRef = useRef(false);
  const awaitingCommandRef = useRef(false);
  const chatEndRef = useRef(null);
  const voiceOnRef = useRef(true);
  const busyRef = useRef(false);
  const pushToTalkActiveRef = useRef(false);
  const restartTimerRef = useRef(null);
  const lastModelRef = useRef(null);

  useEffect(() => { voiceOnRef.current = voiceOn; }, [voiceOn]);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Staggered initialization to avoid Render 429 request spikes
  useEffect(() => {
    const initApp = async () => {
      try {
        const healthRes = await fetch(`${getApiBase()}/health`);
        const healthData = await healthRes.json();
        setConnected(true);
        setConfiguredProviders(healthData.configuredProviders || []);
        if (healthData.lastUsed) {
          setActiveProvider(healthData.lastUsed);
          lastModelRef.current = healthData.lastUsed;
        }
      } catch {
        setConnected(false);
      }

      try {
        const chatRes = await fetch(`${getApiBase()}/api/conversation`);
        const chatData = await chatRes.json();
        const stored = chatData.messages || [];
        setMessages([
          { role: "system", content: 'Aria is ready. Type a message, tap talk, or turn on wake-word listening.' },
          ...stored,
        ]);
      } catch {
        addMsg("system", "Couldn't load chat history from server.");
      }
    };

    initApp();
  }, []);

  useEffect(() => {
    async function refreshPanel() {
      try {
        const [r, n, m] = await Promise.all([
          fetch(`${getApiBase()}/api/reminders`).then((res) => res.json()),
          fetch(`${getApiBase()}/api/notes`).then((res) => res.json()),
          fetch(`${getApiBase()}/api/memory`).then((res) => res.json()),
        ]);
        setReminders(r.reminders || []);
        setNotes(n.notes || []);
        setMemoryFacts(m.facts || []);
      } catch {}
    }
    refreshPanel();
    const interval = setInterval(refreshPanel, 20000);
    return () => clearInterval(interval);
  }, []);

  function addMsg(role, content) {
    setMessages((prev) => [...prev, { role, content }]);
  }

  function speak(text, force) {
    if ((!voiceOnRef.current && !force) || !window.speechSynthesis) {
      if (!force) setState("idle");
      return;
    }

    const doSpeak = () => {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find((v) => /Google UK English Female|Samantha|Google US English/i.test(v.name)) ||
        voices.find((v) => v.lang === "en-US");
      if (preferred) u.voice = preferred;
      u.rate = 1.02;
      u.onstart = () => setState("speaking");
      u.onend = () => setState("idle");
      u.onerror = () => setState("idle");
      window.speechSynthesis.speak(u);
    };

    if (window.speechSynthesis.getVoices().length === 0) {
      const onVoices = () => {
        window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
        doSpeak();
      };
      window.speechSynthesis.addEventListener("voiceschanged", onVoices);
      setTimeout(() => {
        window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
        doSpeak();
      }, 400);
    } else {
      doSpeak();
    }
  }

  async function handleIncoming(text, fromVoice) {
    if (!text || !text.trim() || busyRef.current) return;
    addMsg("user", text);

    const offlineReply = tryOfflineCommand(text);
    if (offlineReply) {
      addMsg("assistant", offlineReply);
      if (fromVoice) speak(offlineReply);
      else setState("idle");
      return;
    }

    setBusy(true);
    setState("thinking");
    try {
      const res = await fetch(`${getApiBase()}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (data.provider && data.model) {
        setActiveProvider(`${data.provider}/${data.model}`);
      }

      (data.actions || []).forEach((a) => {
        if (a.type === "open_url") {
          const r = openTab(a.url);
          if (r.blocked) addMsg("system", blockedMsg(a.url));
        }
      });

      addMsg("assistant", data.reply);
      if (fromVoice) speak(data.reply);
      else setState("idle");
    } catch (err) {
      addMsg("system", "Error: " + err.message);
      const msg = "Sorry, I hit a snag connecting to my brain. Mind trying again?";
      addMsg("assistant", msg);
      if (fromVoice) speak(msg);
      else setState("idle");
    }
    setBusy(false);
  }

  function makeRecognizer(continuous) {
    if (!SR) return null;
    const r = new SR();
    r.continuous = continuous;
    r.interimResults = false;
    r.lang = "en-US";
    return r;
  }

  function startPushToTalk() {
    if (!SR) return;
    if (busyRef.current || state === "listening" || pushToTalkActiveRef.current) return;

    const wasContinuous = continuousRef.current;
    if (wasContinuous && recognitionRef.current) {
      continuousRef.current = false;
      try { recognitionRef.current.stop(); } catch {}
    }

    pushToTalkActiveRef.current = true;
    const r = makeRecognizer(false);

    r.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      handleIncoming(transcript, true);
    };
    r.onerror = () => setState("idle");
    r.onend = () => {
      setState("idle");
      pushToTalkActiveRef.current = false;
      if (wasContinuous && wakeOn) {
        restartTimerRef.current = setTimeout(() => startContinuousListening(), 250);
      }
    };

    setState("listening");
    try { r.start(); } catch { setState("idle"); }
  }

  function toggleWakeWord() {
    if (!wakeOn) {
      if (!SR) return;
      addMsg("system", 'Wake-word listening active — say "Aria".');
      setWakeOn(true);
      startContinuousListening();
    } else {
      addMsg("system", "Wake-word listening off.");
      setWakeOn(false);
      continuousRef.current = false;
      clearTimeout(restartTimerRef.current);
      if (recognitionRef.current) recognitionRef.current.stop();
      setState("idle");
    }
  }

  function startContinuousListening() {
    if (!SR) return;
    const r = makeRecognizer(true);
    recognitionRef.current = r;
    continuousRef.current = true;

    r.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      if (!last.isFinal) return;
      const transcript = last[0].transcript.trim();
      const lower = transcript.toLowerCase();

      if (awaitingCommandRef.current) {
        awaitingCommandRef.current = false;
        handleIncoming(transcript, true);
        return;
      }
      if (lower.includes("aria")) {
        const idx = lower.indexOf("aria");
        const after = transcript.slice(idx + 4).replace(/^[,.\s]+/, "");
        if (after.length > 2) {
          handleIncoming(after, true);
        } else {
          awaitingCommandRef.current = true;
          setState("listening");
          speak("Yeah?");
        }
      }
    };
    r.onend = () => {
      if (continuousRef.current && !pushToTalkActiveRef.current) {
        restartTimerRef.current = setTimeout(() => r.start(), 300);
      }
    };
    try { r.start(); } catch {}
  }

  async function onClearConversation() {
    await fetch(`${getApiBase()}/api/conversation/clear`, { method: "POST" }).catch(() => {});
    setMessages([{ role: "system", content: "Conversation cleared." }]);
  }

  async function onDeleteMemoryFact(id) {
    setMemoryFacts((prev) => prev.filter((f) => f._id !== id && f.id !== id));
    await fetch(`${getApiBase()}/api/memory/${id}`, { method: "DELETE" }).catch(() => {});
  }

  function onSaveSettings() {
    setApiBase(serverUrlInput);
    setSettingsOpen(false);
    window.location.reload();
  }

  const orbLabel =
    state === "listening" ? "Listening..." :
    state === "thinking" ? "Thinking..." :
    state === "speaking" ? "Speaking..." :
    wakeOn ? 'Say "Aria" to wake' : "Tap talk or type below";

  return (
    <div className="app flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 font-sans">
      <NeuronField state={state} />

      {/* Top Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 z-20">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-black tracking-wider text-cyan-400">ARIA</h1>
          <span className="text-xs text-slate-400 hidden sm:inline">| Voice Companion</span>
        </div>
        <div className="flex items-center gap-3">
          {activeProvider && (
            <div className="hidden md:flex px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-full text-xs text-cyan-300">
              ⚡ {activeProvider}
            </div>
          )}
          <button 
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-sm font-medium transition"
            onClick={() => setPanelOpen((v) => !v)}
          >
            🗒️ Workspace {reminders.length + notes.length > 0 && `(${reminders.length + notes.length})`}
          </button>
          <button 
            className="p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-sm transition"
            onClick={() => { setServerUrlInput(getApiBase()); setSettingsOpen(true); }}
            title="Settings"
          >
            ⚙️
          </button>
          <div className="flex items-center gap-2 px-2 py-1 bg-slate-900 rounded-full border border-slate-800">
            <span className={`w-2.5 h-2.5 rounded-full ${connected === false ? 'bg-red-500' : state !== 'idle' ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`}></span>
            <span className="text-xs capitalize hidden lg:inline">{connected === false ? "offline" : state}</span>
          </div>
        </div>
      </header>

      {/* Main Responsive Layout: Split on Laptop, Stacked/Flexible on Mobile */}
      <main className="flex flex-1 overflow-hidden relative">
        
        {/* Left/Top Orb & Quick Control Section */}
        <section className="flex flex-col items-center justify-center p-4 w-full md:w-96 bg-slate-900/40 border-r border-slate-800/80 shrink-0">
          <div className="relative flex flex-col items-center my-auto">
            <div className={`w-32 h-32 md:w-40 md:h-40 rounded-full flex items-center justify-center transition-all duration-500 ${state === 'listening' ? 'ring-4 ring-cyan-500/50 shadow-lg shadow-cyan-500/30 animate-pulse' : state === 'speaking' ? 'ring-4 ring-emerald-500/50 shadow-lg shadow-emerald-500/30' : 'bg-slate-900/80 border border-slate-700'}`}>
              <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-gradient-to-tr from-cyan-600 to-blue-500 flex items-center justify-center shadow-inner">
                <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm"></div>
              </div>
            </div>
            <p className="mt-4 text-xs font-semibold tracking-wide text-cyan-400 uppercase">{orbLabel}</p>
          </div>

          <div className="w-full space-y-2.5 mt-auto pb-2">
            <button 
              className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl shadow-lg shadow-cyan-900/30 transition flex items-center justify-center gap-2"
              onClick={startPushToTalk}
            >
              🎙️ Tap to Talk
            </button>
            <div className="flex items-center justify-between px-3 py-2 bg-slate-800/60 rounded-xl border border-slate-700/60 text-sm">
              <span>Wake-word ("Aria")</span>
              <button 
                className={`w-11 h-6 flex items-center rounded-full p-1 transition ${wakeOn ? 'bg-cyan-500 justify-end' : 'bg-slate-700 justify-start'}`}
                onClick={toggleWakeWord}
              >
                <div className="w-4 h-4 rounded-full bg-white shadow-md"></div>
              </button>
            </div>
            <div className="flex items-center justify-between px-3 py-2 bg-slate-800/60 rounded-xl border border-slate-700/60 text-sm">
              <span>Voice replies</span>
              <button 
                className={`w-11 h-6 flex items-center rounded-full p-1 transition ${voiceOn ? 'bg-cyan-500 justify-end' : 'bg-slate-700 justify-start'}`}
                onClick={() => setVoiceOn((v) => !v)}
              >
                <div className="w-4 h-4 rounded-full bg-white shadow-md"></div>
              </button>
            </div>
            <button 
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-medium rounded-xl border border-slate-700 transition"
              onClick={onClearConversation}
            >
              🗑️ Clear History
            </button>
          </div>
        </section>

        {/* Chat Feed & Composer */}
        <section className="flex-1 flex flex-col h-full bg-slate-950 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : m.role === 'system' ? 'items-center' : 'items-start'}`}>
                {m.role !== 'system' && (
                  <span className="text-[10px] uppercase font-bold text-slate-500 mb-1 px-1">
                    {m.role === 'user' ? 'You' : 'Aria'}
                  </span>
                )}
                <div className={`max-w-xl p-3.5 rounded-2xl text-sm leading-relaxed shadow-sm ${
                  m.role === 'user' 
                    ? 'bg-cyan-600 text-white rounded-br-none' 
                    : m.role === 'system'
                    ? 'bg-slate-900 border border-slate-800 text-slate-400 text-center w-full'
                    : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-none'
                }`}>
                  {linkify(m.content)}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          <div className="p-3 bg-slate-900/90 border-t border-slate-800 flex gap-2 items-center">
            <input
              type="text"
              placeholder="Type a message or command..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (setInput(""), handleIncoming(input, false))}
              className="flex-1 px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 text-sm text-white placeholder-slate-500 transition"
            />
            <button 
              className="px-5 py-3 bg-cyan-600 hover:bg-cyan-500 font-semibold rounded-xl text-sm shadow-md transition"
              onClick={() => { const val = input; setInput(""); handleIncoming(val, false); }}
            >
              Send
            </button>
          </div>
        </section>

        {/* Responsive Side Panel / Drawer */}
        {panelOpen && (
          <aside className="absolute right-0 top-0 bottom-0 w-80 md:w-96 bg-slate-900 border-l border-slate-800 z-30 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <h2 className="font-bold text-cyan-400">Workspace & Memory</h2>
              <button onClick={() => setPanelOpen(false)} className="text-slate-400 hover:text-white p-1">✕</button>
            </div>
            
            <div className="flex border-b border-slate-800 bg-slate-950/50">
              <button 
                className={`flex-1 py-2.5 text-xs font-semibold border-b-2 transition ${panelTab === 'reminders' ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-slate-400'}`}
                onClick={() => setPanelTab('reminders')}
              >
                Reminders ({reminders.length})
              </button>
              <button 
                className={`flex-1 py-2.5 text-xs font-semibold border-b-2 transition ${panelTab === 'notes' ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-slate-400'}`}
                onClick={() => setPanelTab('notes')}
              >
                Notes ({notes.length})
              </button>
              <button 
                className={`flex-1 py-2.5 text-xs font-semibold border-b-2 transition ${panelTab === 'memory' ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-slate-400'}`}
                onClick={() => setPanelTab('memory')}
              >
                Memory ({memoryFacts.length})
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {panelTab === 'reminders' && (
                reminders.length === 0 ? <p className="text-xs text-slate-500 text-center py-6">No active reminders.</p> :
                reminders.map((r) => (
                  <div key={r._id || r.id} className="p-3 bg-slate-800/60 border border-slate-700/60 rounded-xl">
                    <p className="text-sm font-medium">{r.text}</p>
                    <span className="text-[10px] text-cyan-400 mt-1 block">{new Date(r.dueAt).toLocaleString()}</span>
                  </div>
                ))
              )}

              {panelTab === 'notes' && (
                notes.length === 0 ? <p className="text-xs text-slate-500 text-center py-6">No saved notes.</p> :
                notes.map((n) => (
                  <div key={n._id || n.id} className="p-3 bg-slate-800/60 border border-slate-700/60 rounded-xl text-sm">
                    {n.text}
                  </div>
                ))
              )}

              {panelTab === 'memory' && (
                memoryFacts.length === 0 ? <p className="text-xs text-slate-500 text-center py-6">No long-term memories stored.</p> :
                memoryFacts.map((f) => (
                  <div key={f._id || f.id} className="flex items-center justify-between p-3 bg-slate-800/60 border border-slate-700/60 rounded-xl text-sm">
                    <span>{f.fact}</span>
                    <button onClick={() => onDeleteMemoryFact(f._id || f.id)} className="text-red-400 hover:text-red-300 ml-2">✕</button>
                  </div>
                ))
              )}
            </div>
          </aside>
        )}
      </main>

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-cyan-400 mb-4">Settings</h3>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Backend Server URL</label>
            <input 
              type="text" 
              value={serverUrlInput} 
              onChange={(e) => setServerUrlInput(e.target.value)} 
              className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-cyan-500 mb-4"
              placeholder="https://your-backend.onrender.com"
            />
            <div className="flex justify-end gap-3">
              <button onClick={() => setSettingsOpen(false)} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-xl">Cancel</button>
              <button onClick={onSaveSettings} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold rounded-xl">Save & Reload</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}