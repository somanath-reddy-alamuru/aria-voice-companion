import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import NeuronField from "./NeuronField.jsx";
import "./index.css";

const TOKEN_KEY = "aria_auth_token";

function getApiBase() {
  if (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  return "http://localhost:3001";
}

const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

function cleanTextForSpeech(text) {
  if (!text) return "";
  let cleaned = text;
  cleaned = cleaned.replace(/```[\s\S]*?```/g, " I have provided the code on your screen. ");
  cleaned = cleaned.replace(/`([^`]+)`/g, "$1");
  cleaned = cleaned.replace(/[#*_[\]()!~`>-]/g, " ");
  cleaned = cleaned.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDDFF])/g, "");
  return cleaned.replace(/\s+/g, " ").trim();
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [authError, setAuthError] = useState("");

  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [state, setState] = useState("idle"); 
  const [voiceOn, setVoiceOn] = useState(true);
  
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState("chats");
  
  const chatEndRef = useRef(null);
  const googleBtnRef = useRef(null);
  const voiceOnRef = useRef(true);
  const busyRef = useRef(false);

  useEffect(() => { voiceOnRef.current = voiceOn; }, [voiceOn]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    if (token) {
      fetch(`${getApiBase()}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      .then(res => res.json())
      .then(data => {
        if (data.user) {
          setUser(data.user);
          loadSessions();
        } else {
          logout();
        }
      })
      .catch(() => logout());
    }
  }, [token]);

  // Initialize Google Sign-In SDK Button
  useEffect(() => {
    if (!user && window.google) {
      try {
        window.google.accounts.id.initialize({
          client_id: "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com", // Replace with your Google OAuth Client ID if desired, or let it prompt
          callback: handleGoogleResponse,
        });
        if (googleBtnRef.current) {
          window.google.accounts.id.renderButton(googleBtnRef.current, {
            theme: "outline",
            size: "large",
            width: "100%",
          });
        }
      } catch (e) {
        console.warn("Google SDK failed to load:", e);
      }
    }
  }, [user, authMode]);

  async function handleGoogleResponse(response) {
    setAuthError("");
    try {
      const res = await fetch(`${getApiBase()}/api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: response.credential })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Google authentication failed");
      
      localStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      setUser(data.user);
      loadSessions();
    } catch (err) {
      setAuthError(err.message);
    }
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setUser(null);
  }

  async function handleAuth(e) {
    e.preventDefault();
    setAuthError("");
    const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
    try {
      const res = await fetch(`${getApiBase()}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Authentication failed");
      
      localStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      setUser(data.user);
      loadSessions();
    } catch (err) {
      setAuthError(err.message);
    }
  }

  async function loadSessions() {
    try {
      const res = await fetch(`${getApiBase()}/api/sessions`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setSessions(Array.isArray(data) ? data : []);
      if (data.length > 0 && !currentSessionId) loadSession(data[0]._id);
      else if (data.length === 0) startNewSession();
    } catch {}
  }

  async function loadSession(id) {
    try {
      const res = await fetch(`${getApiBase()}/api/sessions/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setMessages(data.messages || []);
      setCurrentSessionId(data._id);
      setPanelOpen(false);
    } catch {}
  }

  function startNewSession() {
    setCurrentSessionId(null);
    setMessages([{ role: "system", content: `Welcome back, ${user?.name || "Friend"}! How can I help you today?` }]);
    setPanelOpen(false);
  }

  async function deleteSession(id, e) {
    e.stopPropagation();
    await fetch(`${getApiBase()}/api/sessions/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (currentSessionId === id) startNewSession();
    loadSessions();
  }

  function speak(text) {
    if (!voiceOnRef.current || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    
    const spokenText = cleanTextForSpeech(text);
    const u = new SpeechSynthesisUtterance(spokenText);
    
    u.onstart = () => setState("speaking");
    u.onend = () => setState("idle");
    u.onerror = () => setState("idle");
    window.speechSynthesis.speak(u);
  }

  async function handleIncoming(text) {
    if (!text.trim() || busyRef.current) return;
    setMessages(prev => [...prev, { role: "user", content: text }]);
    busyRef.current = true;
    setState("thinking");

    try {
      const res = await fetch(`${getApiBase()}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: text, sessionId: currentSessionId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (data.sessionId && data.sessionId !== currentSessionId) {
        setCurrentSessionId(data.sessionId);
        loadSessions();
      }

      (data.actions || []).forEach(a => {
        if (a.type === "open_url") window.open(a.url, "_blank");
      });

      setMessages(prev => [...prev, { role: "assistant", content: data.reply }]);
      speak(data.reply);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Sorry, I encountered an error." }]);
      setState("idle");
    }
    busyRef.current = false;
  }

  function startListening() {
    if (!SR) return alert("Speech Recognition not supported in this browser.");
    const r = new SR();
    r.onstart = () => setState("listening");
    r.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      handleIncoming(transcript);
    };
    r.onerror = () => setState("idle");
    r.onend = () => setState("idle");
    r.start();
  }

  if (!user) {
    return (
      <div className="auth-container">
        <div className="auth-box">
          <h1>ARIA AI</h1>
          <p>Your Intelligent Voice Companion</p>
          
          <form onSubmit={handleAuth}>
            {authError && <div className="auth-error">{authError}</div>}
            {authMode === "register" && (
              <input type="text" placeholder="Full Name" value={name} onChange={e => setName(e.target.value)} required />
            )}
            <input type="email" placeholder="Email Address" value={email} onChange={e => setEmail(e.target.value)} required />
            <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
            
            <button type="submit" className="primary-btn">
              {authMode === "login" ? "Sign In" : "Register"}
            </button>
            
            {/* Real Google Sign In Button Container */}
            <div ref={googleBtnRef} style={{ display: 'flex', justifyContent: 'center', marginBottom: '14px', width: '100%' }}></div>

            <p className="auth-switch" onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}>
              {authMode === "login" ? "Need an account? Register" : "Already have an account? Sign In"}
            </p>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <NeuronField state={state} />

      <header>
        <div className="brand">
          <img src={user.avatar} alt="Avatar" className="user-avatar" />
          <div>
            <h1>ARIA</h1>
            <span>{user.name}</span>
          </div>
        </div>
        <div className="header-right">
          <button className="panel-toggle" onClick={() => setPanelOpen(!panelOpen)}>🗒️ Menu</button>
          <button className="panel-toggle logout-btn" onClick={logout}>Logout</button>
          <div className="status-pill">
            <span className={`status-dot ${state}`}></span>
            <span>{state}</span>
          </div>
        </div>
      </header>

      <main>
        <section className="orb-panel">
          <div className="orb-wrap" onClick={startListening}>
            <div className={`orb-ring ${state !== "idle" ? "active" : ""}`}></div>
            <div className={`orb ${state}`}>
              <div className="orb-core"></div>
            </div>
          </div>
          <div className="orb-label">{state === "idle" ? "Tap to speak" : state}</div>

          <div className="controls">
            <button className="primary" onClick={startListening}>🎙️ Tap to Talk</button>
            <button onClick={() => setVoiceOn(!voiceOn)}>🔊 Voice: {voiceOn ? "ON" : "OFF"}</button>
          </div>
        </section>

        <section className="chat-panel">
          <div className="chat-log">
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.role !== "system" && <span className="tag">{m.role === "user" ? user.name : "ARIA"}</span>}
                <div>
                  <ReactMarkdown
                    components={{
                      code({ node, inline, className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || "");
                        return !inline && match ? (
                          <SyntaxHighlighter style={vscDarkPlus} language={match[1]} PreTag="div" {...props}>
                            {String(children).replace(/\n$/, "")}
                          </SyntaxHighlighter>
                        ) : (
                          <code {...props}>{children}</code>
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
              placeholder="Type a message..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (handleIncoming(input), setInput(""))}
            />
            <button onClick={() => (handleIncoming(input), setInput(""))}>➤</button>
          </div>
        </section>

        {panelOpen && (
          <aside className="side-panel">
            <div className="side-panel-header">
              <span>Dashboard</span>
              <button className="close-btn" onClick={() => setPanelOpen(false)}>✕</button>
            </div>
            
            <div className="panel-tabs">
              <button className={panelTab === "chats" ? "active" : ""} onClick={() => setPanelTab("chats")}>History</button>
            </div>

            {panelTab === "chats" && (
              <div className="side-panel-section">
                <button onClick={startNewSession} className="new-chat-btn">+ New Chat</button>
                {sessions.map(s => (
                  <div key={s._id} className="side-item memory-item" onClick={() => loadSession(s._id)}>
                    <span>{s.title}</span>
                    <button className="forget-btn" onClick={(e) => deleteSession(s._id, e)}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </aside>
        )}
      </main>
    </div>
  );
}