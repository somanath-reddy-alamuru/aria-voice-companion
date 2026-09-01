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
  "google drive": "https://drive.google.com",
  calendar: "https://calendar.google.com",
  github: "https://github.com",
  linkedin: "https://linkedin.com",
  leetcode: "https://leetcode.com",
  chatgpt: "https://chat.openai.com",
  netflix: "https://netflix.com",
  spotify: "https://open.spotify.com",
  amazon: "https://amazon.in",
  whatsapp: "https://wa.me/",
  instagram: "https://instagram.com",
  facebook: "https://facebook.com",
  twitter: "https://x.com",
  x: "https://x.com",
  telegram: "https://t.me",
  reddit: "https://reddit.com",
  twitch: "https://twitch.tv",
  discord: "https://discord.com/app",
  notion: "https://notion.so",
  zoom: "https://zoom.us/join",
  flipkart: "https://flipkart.com",
  swiggy: "https://swiggy.com",
  zomato: "https://zomato.com",
  playstore: "https://play.google.com/store",
  "play store": "https://play.google.com/store",
  news: "https://news.google.com",
  translate: "https://translate.google.com",
  photos: "https://photos.google.com",
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
  m = text.match(/^search youtube for (.+)/);
  if (m) {
    const r = openTab("https://www.youtube.com/results?search_query=" + encodeURIComponent(m[1]));
    return r.blocked ? blockedMsg(r.url) : `Searching YouTube for "${m[1]}".`;
  }

  return null;
}

function blockedMsg(url) {
  return `Your browser blocked that popup. Tap to open: ${url}`;
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
      <a key={i} href={part} target="_blank" rel="noopener noreferrer">
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

  useEffect(() => {
    fetch(`${getApiBase()}/api/conversation`)
      .then((r) => r.json())
      .then((data) => {
        const stored = data.messages || [];
        setMessages([
          { role: "system", content: 'Aria is ready. Type a message, tap talk, or turn on wake-word listening.' },
          ...stored,
        ]);
      })
      .catch(() => {
        addMsg("system", "Couldn't reach the server — check your backend deployment URL.");
      });

    fetch(`${getApiBase()}/health`)
      .then((r) => r.json())
      .then((data) => {
        setConnected(true);
        setConfiguredProviders(data.configuredProviders || []);
        if (data.configuredProviders?.length === 0) {
          addMsg("system", "No AI provider is configured yet — add API keys to your server environment variables.");
        }
        if (data.lastUsed) {
          setActiveProvider(data.lastUsed);
          lastModelRef.current = data.lastUsed;
        }
      })
      .catch(() => {
        setConnected(false);
        addMsg("system", `Can't reach the Aria server at ${getApiBase() || "(same origin)"}.`);
      });

    if (!window.isSecureContext) {
      addMsg("system", "This page isn't on a secure context (HTTPS required for microphone permissions in production).");
    } else if (!SR) {
      addMsg("system", "This browser doesn't support voice input — use Chrome or Edge for full microphone functionality.");
    }
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
    async function checkDue() {
      try {
        const res = await fetch(`${getApiBase()}/api/reminders/due`);
        const data = await res.json();
        (data.due || []).forEach((r) => {
          const text = `Reminder: ${r.text}`;
          addMsg("assistant", text);
          if (voiceOnRef.current && !busyRef.current) speak(text);
        });
        if ((data.due || []).length) refreshPanel();
      } catch {}
    }
    refreshPanel();
    const dueInterval = setInterval(checkDue, 20000);
    const panelInterval = setInterval(refreshPanel, 15000);
    return () => {
      clearInterval(dueInterval);
      clearInterval(panelInterval);
    };
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
      u.onerror = (e) => {
        addMsg("system", `Voice output failed: ${e.error}.`);
        setState("idle");
      };
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

  async function callAria(message) {
    const res = await fetch(`${getApiBase()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `Server responded ${res.status}`);
    }
    return res.json();
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
      const { reply, actions, provider, model } = await callAria(text);

      const combined = provider && model ? `${provider}/${model}` : null;
      if (combined && lastModelRef.current && combined !== lastModelRef.current) {
        addMsg("system", `🔄 Switched AI provider to ${combined}`);
      }
      if (combined) {
        lastModelRef.current = combined;
        setActiveProvider(combined);
      }

      (actions || []).forEach((a) => {
        if (a.type === "open_url") {
          const r = openTab(a.url);
          if (r.blocked) addMsg("system", blockedMsg(a.url));
        }
      });

      addMsg("assistant", reply);
      if (fromVoice) speak(reply);
      else setState("idle");

      Promise.all([
        fetch(`${getApiBase()}/api/reminders`).then((r) => r.json()).catch(() => null),
        fetch(`${getApiBase()}/api/notes`).then((r) => r.json()).catch(() => null),
      ]).then(([r, n]) => {
        if (r) setReminders(r.reminders || []);
        if (n) setNotes(n.notes || []);
      });
    } catch (err) {
      addMsg("system", "Error: " + err.message);
      const msg = "Sorry — I hit a snag reaching my brain. Mind trying that again?";
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

  function explainSpeechError(errorCode) {
    switch (errorCode) {
      case "not-allowed":
      case "permission-denied":
        return 'Mic access is blocked. Check your browser site permissions.';
      case "audio-capture":
        return "No microphone was found.";
      case "no-speech":
        return null;
      case "network":
        return "Speech recognition network error.";
      case "aborted":
        return null;
      default:
        return `Mic error: ${errorCode || "unknown"}.`;
    }
  }

  function startPushToTalk() {
    if (!SR) return;
    if (busyRef.current || state === "listening" || pushToTalkActiveRef.current) return;

    const wasContinuous = continuousRef.current;
    if (wasContinuous && recognitionRef.current) {
      continuousRef.current = false;
      recognitionRef.current.onend = null;
      try { recognitionRef.current.stop(); } catch {}
    }

    pushToTalkActiveRef.current = true;
    const r = makeRecognizer(false);

    const resumeWakeWordIfNeeded = () => {
      pushToTalkActiveRef.current = false;
      if (wasContinuous && wakeOn) {
        restartTimerRef.current = setTimeout(() => startContinuousListening(), 250);
      }
    };

    r.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      handleIncoming(transcript, true);
    };
    r.onerror = (e) => {
      const msg = explainSpeechError(e.error);
      if (msg) addMsg("system", msg);
      setState("idle");
    };
    r.onend = () => {
      setState((s) => (s === "listening" ? "idle" : s));
      resumeWakeWordIfNeeded();
    };

    setState("listening");
    try {
      r.start();
    } catch (err) {
      setState("idle");
      resumeWakeWordIfNeeded();
    }
  }

  function testVoiceOutput() {
    addMsg("system", "Testing voice output…");
    speak("This is a voice test. If you can hear this, text to speech is working.", true);
  }

  function startContinuousListening() {
    if (!SR) return;
    const r = makeRecognizer(true);
    recognitionRef.current = r;
    continuousRef.current = true;
    setState((s) => (s === "listening" || s === "speaking" || s === "thinking" ? s : "idle"));

    const scheduleRestart = (delay) => {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => {
        if (continuousRef.current && !pushToTalkActiveRef.current) {
          try { r.start(); } catch {}
        }
      }, delay);
    };

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
      if (continuousRef.current && !pushToTalkActiveRef.current) scheduleRestart(300);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "audio-capture") {
        setWakeOn(false);
        continuousRef.current = false;
        return;
      }
      if (continuousRef.current && !pushToTalkActiveRef.current) scheduleRestart(500);
    };
    try {
      r.start();
    } catch (err) {
      setWakeOn(false);
      continuousRef.current = false;
    }
  }

  function toggleWakeWord() {
    if (!wakeOn) {
      if (!SR) return;
      addMsg("system", 'Wake-word listening on — say "Aria" any time.');
      setWakeOn(true);
      startContinuousListening();
    } else {
      addMsg("system", "Wake-word listening off.");
      setWakeOn(false);
      continuousRef.current = false;
      clearTimeout(restartTimerRef.current);
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      }
      setState("idle");
    }
  }

  function onSend() {
    const val = input;
    setInput("");
    handleIncoming(val, false);
  }

  async function onClearConversation() {
    await fetch(`${getApiBase()}/api/conversation/clear`, { method: "POST" }).catch(() => {});
    setMessages([{ role: "system", content: "Conversation cleared." }]);
  }

  async function onDeleteMemoryFact(id) {
    setMemoryFacts((prev) => prev.filter((f) => f.id !== id));
    try {
      const res = await fetch(`${getApiBase()}/api/memory/${id}`, { method: "DELETE" });
      const data = await res.json();
      setMemoryFacts(data.facts || []);
    } catch {}
  }

  function onSaveSettings() {
    setApiBase(serverUrlInput);
    setSettingsOpen(false);
    setConnected(null);
    fetch(`${getApiBase()}/health`)
      .then((r) => r.json())
      .then((data) => {
        setConnected(true);
        setConfiguredProviders(data.configuredProviders || []);
      })
      .catch(() => setConnected(false));
  }

  const orbLabel =
    state === "listening"
      ? "Listening…"
      : state === "thinking"
      ? "Thinking…"
      : state === "speaking"
      ? "Speaking…"
      : wakeOn
      ? 'Say "Aria" to wake me'
      : "Tap talk or type below";

  return (
    <div className="app mobile-responsive-layout">
      <NeuronField state={state} />

      <header className="mobile-header">
        <div className="brand">
          <h1>ARIA</h1>
          <span>your voice companion</span>
        </div>
        <div className="header-right">
          {activeProvider && (
            <div className="provider-pill hidden sm:block" title={`${configuredProviders.length} provider(s) configured`}>
              ⚡ {activeProvider}
            </div>
          )}
          <button className="panel-toggle" onClick={() => setPanelOpen((v) => !v)}>
            🗒️ {reminders.length + notes.length + memoryFacts.length > 0 ? `(${reminders.length + notes.length + memoryFacts.length})` : ""}
          </button>
          <button className="panel-toggle icon-btn" onClick={() => { setServerUrlInput(getApiBase()); setSettingsOpen(true); }} title="Settings">
            ⚙️
          </button>
          <div className="status-pill">
            <span className={`status-dot ${connected === false ? "offline" : state !== "idle" ? state : ""}`}></span>
            <span className="hidden sm:inline">{connected === false ? "offline" : state}</span>
          </div>
        </div>
      </header>

      <main className="mobile-main-grid">
        <section className="orb-panel">
          <div className="orb-wrap">
            <div className={`orb-ring ${state === "listening" || state === "speaking" ? "active" : ""} ${state === "speaking" ? "speaking" : ""}`}></div>
            <div className={`orb-ring ${state === "listening" || state === "speaking" ? "active" : ""} ${state === "speaking" ? "speaking" : ""}`}></div>
            <div className={`orb ${state === "listening" ? "listening" : ""} ${state === "speaking" ? "speaking" : ""}`}>
              <div className="orb-core"></div>
            </div>
          </div>
          <div className="orb-label">{orbLabel}</div>

          <div className="controls">
            <button className="primary" onClick={startPushToTalk}>🎙️ Tap to Talk</button>
            <div className="toggle-row">
              <span>Wake-word listening</span>
              <div className={`switch ${wakeOn ? "on" : ""}`} onClick={toggleWakeWord}></div>
            </div>
            <div className="toggle-row">
              <span>Voice replies</span>
              <div className={`switch ${voiceOn ? "on" : ""}`} onClick={() => setVoiceOn((v) => !v)}></div>
            </div>
            <button onClick={testVoiceOutput}>🔊 Test voice output</button>
            <button onClick={onClearConversation}>🗑️ Clear conversation</button>
          </div>

          <div className="hint hidden md:block">
            Try: <b>"Aria, what's the weather in Chennai"</b>, <b>"remind me to drink water in 20 minutes"</b>,
            <b> "open YouTube and play believer"</b>
          </div>
        </section>

        <section className="chat-panel">
          <div className="chat-log">
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.role !== "system" && <span className="tag">{m.role === "user" ? "YOU" : "ARIA"}</span>}
                <div>{linkify(m.content)}</div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="composer">
            <input
              type="text"
              placeholder="Type instead of talking…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSend()}
            />
            <button className={`mic ${state === "listening" ? "active" : ""}`} onClick={startPushToTalk} title="Tap to talk">🎤</button>
            <button onClick={onSend} title="Send">➤</button>
          </div>
        </section>

        {panelOpen && (
          <aside className="side-panel mobile-drawer">
            <div className="side-panel-header">
              <span>Your Aria</span>
              <button className="close-btn" onClick={() => setPanelOpen(false)}>✕</button>
            </div>
            <div className="panel-tabs">
              <button className={panelTab === "reminders" ? "active" : ""} onClick={() => setPanelTab("reminders")}>
                Reminders {reminders.length > 0 && `(${reminders.length})`}
              </button>
              <button className={panelTab === "notes" ? "active" : ""} onClick={() => setPanelTab("notes")}>
                Notes {notes.length > 0 && `(${notes.length})`}
              </button>
              <button className={panelTab === "memory" ? "active" : ""} onClick={() => setPanelTab("memory")}>
                Memory {memoryFacts.length > 0 && `(${memoryFacts.length})`}
              </button>
            </div>

            {panelTab === "reminders" && (
              <div className="side-panel-section">
                {reminders.length === 0 && <p className="empty">Nothing pending</p>}
                {reminders.map((r) => (
                  <div key={r.id || r._id} className="side-item">
                    <span>{r.text}</span>
                    <span className="side-item-meta">{new Date(r.dueAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}

            {panelTab === "notes" && (
              <div className="side-panel-section">
                {notes.length === 0 && <p className="empty">Nothing saved</p>}
                {notes.map((n) => (
                  <div key={n.id || n._id} className="side-item">
                    <span>{n.text}</span>
                  </div>
                ))}
              </div>
            )}

            {panelTab === "memory" && (
              <div className="side-panel-section">
                {memoryFacts.length === 0 && <p className="empty">Nothing yet</p>}
                {memoryFacts.map((f) => (
                  <div key={f.id || f._id} className="side-item memory-item">
                    <span>{f.fact}</span>
                    <button className="forget-btn" onClick={() => onDeleteMemoryFact(f.id || f._id)} title="Forget this">✕</button>
                  </div>
                ))}
              </div>
            )}
          </aside>
        )}
      </main>

      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Settings</h3>
            <label className="modal-label">Aria server URL</label>
            <input
              type="text"
              className="modal-input"
              value={serverUrlInput}
              onChange={(e) => setServerUrlInput(e.target.value)}
              placeholder="https://your-backend.onrender.com"
            />
            <div className="modal-actions">
              <button onClick={() => setSettingsOpen(false)}>Cancel</button>
              <button className="primary" onClick={onSaveSettings}>Save & Reconnect</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}