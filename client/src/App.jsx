import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import NeuronField from "./NeuronField.jsx";
import "./index.css";

const SERVER_URL_KEY = "aria_server_url";

function defaultApiBase() {
  if (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
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

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [state, setState] = useState("idle"); 
  const [wakeOn, setWakeOn] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [busy, setBusy] = useState(false);
  
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState("chats");
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
  const silenceTimerRef = useRef(null);
  const speechBufferRef = useRef("");
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
    let wakeLock = null;
    async function requestWakeLock() {
      if (wakeOn && 'wakeLock' in navigator) {
        try {
          wakeLock = await navigator.wakeLock.request('screen');
        } catch (err) {
          console.warn(`Wake Lock Error: ${err.message}`);
        }
      } else if (!wakeOn && wakeLock) {
        wakeLock.release();
        wakeLock = null;
      }
    }
    requestWakeLock();
    return () => { if (wakeLock) wakeLock.release(); };
  }, [wakeOn]);

  useEffect(() => {
    fetchSessions();
    fetchHealthStatus();

    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    if (!window.isSecureContext) {
      addMsg("system", "This page isn't on HTTPS/localhost — speech recognition will not work.");
    } else if (!SR) {
      addMsg("system", "This browser doesn't support Speech Recognition — open in Chrome or Edge.");
    } else if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => stream.getTracks().forEach((t) => t.stop()))
        .catch((err) => {
          addMsg("system", "Mic access denied: " + (err.message || err.name));
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchSessions = async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/sessions`);
      const data = await res.json();
      setSessions(Array.isArray(data) ? data : []);
      
      if (!currentSessionId && data.length > 0) {
        loadSession(data[0]._id);
      } else if (!currentSessionId && data.length === 0) {
        startNewSession();
      }
    } catch {
      console.warn("Failed to fetch sessions list.");
      startNewSession();
    }
  };

  const fetchHealthStatus = async () => {
    try {
      const r = await fetch(`${getApiBase()}/health`);
      const data = await r.json();
      setConnected(true);
      setConfiguredProviders(data.configuredProviders || []);
      if (data.lastUsed) {
        setActiveProvider(data.lastUsed);
        lastModelRef.current = data.lastUsed;
      }
    } catch {
      setConnected(false);
      addMsg("system", `Can't reach the Aria server at ${getApiBase() || "(same origin)"}.`);
    }
  };

  const loadSession = async (id) => {
    try {
      const res = await fetch(`${getApiBase()}/api/sessions/${id}`);
      const data = await res.json();
      setMessages(data.messages || []);
      setCurrentSessionId(data._id);
      if (window.innerWidth < 768) setPanelOpen(false);
    } catch (err) {
      addMsg("system", "Failed to load session history.");
    }
  };

  const startNewSession = () => {
    setCurrentSessionId(null);
    setMessages([
      { role: "system", content: "Aria is ready. Type a message, tap talk, or say 'Aria'." }
    ]);
    if (window.innerWidth < 768) setPanelOpen(false);
  };

  const deleteSession = async (id, e) => {
    e.stopPropagation();
    try {
      await fetch(`${getApiBase()}/api/sessions/${id}`, { method: "DELETE" });
      if (currentSessionId === id) {
        startNewSession();
      }
      fetchSessions();
    } catch {
      console.error("Failed to delete session.");
    }
  };

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
          if (Notification.permission === "granted") {
            new Notification("Aria Alarm", { body: r.text, icon: "/favicon.ico" });
          }
          const alarmAudio = new Audio("https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3");
          alarmAudio.play().catch(() => {});

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
      u.onerror = () => setState("idle");
      window.speechSynthesis.speak(u);
    };

    if (window.speechSynthesis.getVoices().length === 0) {
      const onVoices = () => {
        window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
        doSpeak();
      };
      window.speechSynthesis.addEventListener("voiceschanged", onVoices);
      setTimeout(doSpeak, 400);
    } else {
      doSpeak();
    }
  }

  async function callAria(message) {
    const res = await fetch(`${getApiBase()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sessionId: currentSessionId }),
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

    setBusy(true);
    setState("thinking");
    try {
      const { reply, actions, provider, model, sessionId } = await callAria(text);

      if (sessionId && sessionId !== currentSessionId) {
        setCurrentSessionId(sessionId);
      }
      fetchSessions();

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
          window.open(a.url, "_blank");
        }
      });

      addMsg("assistant", reply);
      if (fromVoice) speak(reply);
      else setState("idle");

      fetch(`${getApiBase()}/api/reminders`).then((r) => r.json()).then((data) => setReminders(data.reminders || [])).catch(() => {});
      fetch(`${getApiBase()}/api/notes`).then((r) => r.json()).then((data) => setNotes(data.notes || [])).catch(() => {});
    } catch (err) {
      addMsg("system", "Error: " + err.message);
      const msg = "Sorry, I hit an issue processing that. Please check server connectivity.";
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
    r.interimResults = true;
    r.lang = "en-US";
    return r;
  }

  function startPushToTalk() {
    if (!SR) {
      addMsg("system", "Speech recognition requires Chrome/Edge over HTTPS or localhost.");
      return;
    }
    if (busyRef.current || state === "listening" || pushToTalkActiveRef.current) return;

    const wasContinuous = continuousRef.current;
    if (wasContinuous && recognitionRef.current) {
      continuousRef.current = false;
      recognitionRef.current.onend = null;
      try { recognitionRef.current.stop(); } catch {}
    }

    pushToTalkActiveRef.current = true;
    speechBufferRef.current = "";
    const r = makeRecognizer(true);

    const resumeWakeWordIfNeeded = () => {
      pushToTalkActiveRef.current = false;
      if (wasContinuous && wakeOn) {
        restartTimerRef.current = setTimeout(() => startContinuousListening(), 250);
      }
    };

    r.onstart = () => setState("listening");

    r.onresult = (e) => {
      clearTimeout(silenceTimerRef.current);
      let interim = "";
      let final = "";

      for (let i = e.resultIndex; i < e.results.length; ++i) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }

      speechBufferRef.current += final;
      const fullUtterance = speechBufferRef.current + interim;

      silenceTimerRef.current = setTimeout(() => {
        try { r.stop(); } catch {}
        if (fullUtterance.trim()) {
          handleIncoming(fullUtterance.trim(), true);
        } else {
          setState("idle");
        }
        speechBufferRef.current = "";
      }, 1500);
    };

    r.onerror = (e) => {
      if (e.error !== "no-speech") addMsg("system", `Mic error: ${e.error}`);
      setState("idle");
    };

    r.onend = () => {
      if (!speechBufferRef.current.trim() && state === "listening") setState("idle");
      resumeWakeWordIfNeeded();
    };

    try { r.start(); } catch (err) {
      addMsg("system", "Couldn't start mic: " + err.message);
      setState("idle");
      resumeWakeWordIfNeeded();
    }
  }

  function startContinuousListening() {
    if (!SR) return;
    const r = makeRecognizer(true);
    recognitionRef.current = r;
    continuousRef.current = true;

    r.onresult = (e) => {
      let currentSpeech = "";
      for (let i = e.resultIndex; i < e.results.length; ++i) {
        currentSpeech += e.results[i][0].transcript;
      }
      const lower = currentSpeech.toLowerCase();

      if (awaitingCommandRef.current) {
        clearTimeout(silenceTimerRef.current);
        speechBufferRef.current += currentSpeech;
        
        silenceTimerRef.current = setTimeout(() => {
          awaitingCommandRef.current = false;
          const cmd = speechBufferRef.current;
          speechBufferRef.current = "";
          handleIncoming(cmd, true);
        }, 1500);
        return;
      }

      if (lower.includes("aria")) {
        const idx = lower.indexOf("aria");
        const after = currentSpeech.slice(idx + 4).trim();
        if (after.length > 2) {
          handleIncoming(after, true);
        } else {
          awaitingCommandRef.current = true;
          speechBufferRef.current = "";
          setState("listening");
          speak("Yeah?");
        }
      }
    };

    r.onend = () => {
      if (continuousRef.current && !pushToTalkActiveRef.current) {
        restartTimerRef.current = setTimeout(() => {
          try { r.start(); } catch {}
        }, 300);
      }
    };

    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "audio-capture") {
        setWakeOn(false);
        continuousRef.current = false;
      }
    };

    try { r.start(); } catch {}
  }

  function toggleWakeWord() {
    if (!wakeOn) {
      if (!SR) return addMsg("system", "Speech Recognition non-functional in this browser.");
      addMsg("system", 'Wake-word listening ON — say "Aria" anytime.');
      setWakeOn(true);
      startContinuousListening();
    } else {
      addMsg("system", "Wake-word listening OFF.");
      setWakeOn(false);
      continuousRef.current = false;
      clearTimeout(restartTimerRef.current);
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        try { recognitionRef.current.stop(); } catch {}
      }
      setState("idle");
    }
  }

  function testVoiceOutput() {
    addMsg("system", "Testing voice output…");
    speak("This is a voice test. If you can hear this, text to speech is working.", true);
  }

  function onSend() {
    const val = input;
    setInput("");
    handleIncoming(val, false);
  }

  async function onClearConversation() {
    await fetch(`${getApiBase()}/api/conversation/clear`, { method: "POST" }).catch(() => {});
    if (currentSessionId) await fetch(`${getApiBase()}/api/sessions/${currentSessionId}`, { method: "DELETE" }).catch(() => {});
    startNewSession();
    fetchSessions();
  }

  function onSaveSettings() {
    setApiBase(serverUrlInput);
    setSettingsOpen(false);
    setConnected(null);
    addMsg("system", `Reconnecting…`);
    fetchHealthStatus();
    fetchSessions();
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
    <div className="app">
      <NeuronField state={state} />

      <header>
        <div className="brand">
          <h1>ARIA</h1>
          <span>your voice companion</span>
        </div>
        <div className="header-right">
          {activeProvider && (
            <div className="provider-pill">⚡ {activeProvider.split('/')[0]}</div>
          )}
          <button className="panel-toggle" onClick={() => setPanelOpen((v) => !v)}>
            🗒️ History & Dashboard
          </button>
          <button className="panel-toggle icon-btn" onClick={() => { setServerUrlInput(getApiBase()); setSettingsOpen(true); }} title="Settings">
            ⚙️
          </button>
          <div className="status-pill">
            <span className={`status-dot ${connected === false ? "offline" : state !== "idle" ? state : ""}`}></span>
            <span>{connected === false ? "offline" : state}</span>
          </div>
        </div>
      </header>

      <main>
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
            <button onClick={testVoiceOutput}>🔊 Test voice</button>
            <button onClick={onClearConversation}>🗑️ Clear current chat</button>
          </div>

          <div className="hint">
            Try: <b>"Open notepad"</b>, <b>"open youtube"</b>, or <b>"remind me to check email in 10 minutes"</b>.
          </div>
        </section>

        <section className="chat-panel">
          <div className="chat-log">
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.role !== "system" && <span className="tag">{m.role === "user" ? "YOU" : "ARIA"}</span>}
                <div>
                  <ReactMarkdown
                    components={{
                      code({ node, inline, className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || "");
                        return !inline && match ? (
                          <SyntaxHighlighter
                            style={vscDarkPlus}
                            language={match[1]}
                            PreTag="div"
                            customStyle={{ borderRadius: '6px', margin: '10px 0', background: '#0d1117', fontSize: '0.9em' }}
                            {...props}
                          >
                            {String(children).replace(/\n$/, "")}
                          </SyntaxHighlighter>
                        ) : (
                          <code style={{ background: '#1f2937', padding: '2px 4px', borderRadius: '4px', fontFamily: 'monospace' }} {...props}>
                            {children}
                          </code>
                        );
                      },
                    }}
                  >
                    {m.content}
                  </ReactMarkdown>
                </div>
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
          <aside className="side-panel">
            <div className="side-panel-header">
              <span>Aria Dashboard</span>
              <button className="close-btn" onClick={() => setPanelOpen(false)}>✕</button>
            </div>
            
            <div className="panel-tabs">
              <button className={panelTab === "chats" ? "active" : ""} onClick={() => setPanelTab("chats")}>
                History ({sessions.length})
              </button>
              <button className={panelTab === "reminders" ? "active" : ""} onClick={() => setPanelTab("reminders")}>
                Reminders ({reminders.length})
              </button>
              <button className={panelTab === "notes" ? "active" : ""} onClick={() => setPanelTab("notes")}>
                Notes ({notes.length})
              </button>
              <button className={panelTab === "memory" ? "active" : ""} onClick={() => setPanelTab("memory")}>
                Memory ({memoryFacts.length})
              </button>
            </div>

            {panelTab === "chats" && (
              <div className="side-panel-section">
                <button 
                  onClick={startNewSession} 
                  style={{marginBottom: '15px', width: '100%', padding: '10px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold'}}
                >
                  + Start New Chat
                </button>
                {sessions.length === 0 && <p className="empty">No past chat history found.</p>}
                {sessions.map((s) => (
                  <div 
                    key={s._id} 
                    className="side-item memory-item" 
                    onClick={() => loadSession(s._id)}
                    style={{ cursor: 'pointer', border: currentSessionId === s._id ? "1px solid #3b82f6" : "1px solid transparent", marginBottom: '8px' }}
                  >
                    <span style={{ fontWeight: currentSessionId === s._id ? 'bold' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px' }}>
                      {s.title || "Untitled Chat"}
                    </span>
                    <button 
                      className="forget-btn" 
                      onClick={(e) => deleteSession(s._id, e)} 
                      title="Permanently delete this chat history"
                      style={{ background: '#dc2626', color: 'white', border: 'none', borderRadius: '4px', width: '22px', height: '22px', cursor: 'pointer' }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {panelTab === "reminders" && (
              <div className="side-panel-section">
                {reminders.length === 0 && <p className="empty">Nothing pending</p>}
                {reminders.map((r) => (
                  <div key={r.id} className="side-item">
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
                  <div key={n.id} className="side-item">
                    <span>{n.text}</span>
                  </div>
                ))}
              </div>
            )}

            {panelTab === "memory" && (
              <div className="side-panel-section">
                {memoryFacts.length === 0 && <p className="empty">Nothing remembered yet</p>}
                {memoryFacts.map((f) => (
                  <div key={f.id} className="side-item memory-item">
                    <span>{f.fact}</span>
                    <button className="forget-btn" onClick={async () => {
                      await fetch(`${getApiBase()}/api/memory/${f.id}`, { method: "DELETE" });
                      setMemoryFacts(prev => prev.filter(item => item.id !== f.id));
                    }}>✕</button>
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
              placeholder="http://192.168.1.42:3001"
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