import { useEffect, useMemo, useRef, useState } from "react";

const API_KEY = "aria_server_url";

function getApiBase() {
  const saved = localStorage.getItem(API_KEY);

  if (saved) {
    return saved.replace(/\/+$/, "");
  }

  const envUrl = import.meta.env.VITE_API_URL;

  if (envUrl) {
    return envUrl.replace(/\/+$/, "");
  }

  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return "http://localhost:3001";
  }

  return "";
}

function openUrl(url) {
  const popup = window.open(url, "_blank", "noopener,noreferrer");

  if (!popup) {
    return false;
  }

  return true;
}

function runLocalCommand(text) {
  const value = text.trim();
  const lower = value.toLowerCase();

  // Calculator
  const calcMatch = lower.match(
    /^(?:calculate|compute|what is)\s+([0-9+\-*/().%\s]+)$/
  );

  if (calcMatch) {
    try {
      const expression = calcMatch[1]
        .replace(/%/g, "/100")
        .trim();

      if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
        return null;
      }

      const result = Function(`"use strict"; return (${expression})`)();

      if (Number.isFinite(result)) {
        return {
          reply: `The answer is ${result}.`,
          local: true,
        };
      }
    } catch {
      return {
        reply: "I couldn't calculate that expression.",
        local: true,
      };
    }
  }

  // Time
  if (
    lower === "what time is it" ||
    lower === "what's the time" ||
    lower === "current time" ||
    lower === "time"
  ) {
    return {
      reply: `It's ${new Date().toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })}.`,
      local: true,
    };
  }

  // Date
  if (
    lower === "what date is it" ||
    lower === "today's date" ||
    lower === "what is today's date"
  ) {
    return {
      reply: `Today is ${new Date().toLocaleDateString([], {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })}.`,
      local: true,
    };
  }

  // Open common websites
  const openMatch = lower.match(/^(?:open|launch|go to)\s+(.+)$/);

  if (openMatch) {
    const target = openMatch[1]
      .replace(/[.!?]+$/, "")
      .trim();

    const sites = {
      youtube: "https://www.youtube.com",
      google: "https://www.google.com",
      gmail: "https://mail.google.com",
      github: "https://github.com",
      linkedin: "https://www.linkedin.com",
      instagram: "https://www.instagram.com",
      facebook: "https://www.facebook.com",
      whatsapp: "https://web.whatsapp.com",
      reddit: "https://www.reddit.com",
      spotify: "https://open.spotify.com",
      netflix: "https://www.netflix.com",
      amazon: "https://www.amazon.in",
      flipkart: "https://www.flipkart.com",
      maps: "https://maps.google.com",
      "google maps": "https://maps.google.com",
      drive: "https://drive.google.com",
      calendar: "https://calendar.google.com",
      leetcode: "https://leetcode.com",
      chatgpt: "https://chatgpt.com",
    };

    if (sites[target]) {
      const success = openUrl(sites[target]);

      return {
        reply: success
          ? `Opening ${target}.`
          : `Your browser blocked the popup. Please allow popups for this site.`,
        local: true,
      };
    }

    if (/^[a-z0-9-]+\.[a-z]{2,}$/i.test(target)) {
      const url = `https://${target}`;
      const success = openUrl(url);

      return {
        reply: success
          ? `Opening ${target}.`
          : "Your browser blocked the popup.",
        local: true,
      };
    }
  }

  // Google search
  let match = lower.match(/^search (?:google|the web) for (.+)$/);

  if (match) {
    const query = match[1].trim();
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

    const success = openUrl(url);

    return {
      reply: success
        ? `Searching Google for "${query}".`
        : "Your browser blocked the popup.",
      local: true,
    };
  }

  // YouTube search
  match = lower.match(/^search youtube for (.+)$/);

  if (match) {
    const query = match[1].trim();
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

    const success = openUrl(url);

    return {
      reply: success
        ? `Searching YouTube for "${query}".`
        : "Your browser blocked the popup.",
      local: true,
    };
  }

  return null;
}

function Message({ message }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  return (
    <div
      className={`message-row ${
        isUser ? "user-row" : isSystem ? "system-row" : "assistant-row"
      }`}
    >
      <div
        className={`message ${
          isUser ? "user-message" : isSystem ? "system-message" : "assistant-message"
        }`}
      >
        {!isUser && !isSystem && <div className="message-label">ARIA</div>}
        {isSystem && <div className="message-label">SYSTEM</div>}

        <div className="message-text">{message.content}</div>

        {message.provider && (
          <div className="message-meta">
            {message.provider}/{message.model}
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Hey, I'm Aria. I'm ready. Ask me anything or tell me what you'd like me to do.",
    },
  ]);

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [health, setHealth] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [serverUrl, setServerUrl] = useState(getApiBase());

  const [reminders, setReminders] = useState([]);
  const [notes, setNotes] = useState([]);
  const [memory, setMemory] = useState([]);

  const [panel, setPanel] = useState("reminders");

  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [listening, setListening] = useState(false);

  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const inputRef = useRef(null);

  const speechSupported = useMemo(
    () =>
      typeof window !== "undefined" &&
      !!(window.SpeechRecognition || window.webkitSpeechRecognition),
    []
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages, busy]);

  useEffect(() => {
    checkHealth();
    loadData();

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
    };
  }, []);

  async function checkHealth() {
    try {
      const response = await fetch(`${getApiBase()}/health`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }

      const data = await response.json();

      setHealth(data);
      setConnected(Boolean(data.ok));
    } catch (error) {
      console.error("Health check error:", error);
      setConnected(false);
    }
  }

  async function loadData() {
    const base = getApiBase();

    try {
      const results = await Promise.allSettled([
        fetch(`${base}/api/conversation`).then((r) => r.json()),
        fetch(`${base}/api/reminders`).then((r) => r.json()),
        fetch(`${base}/api/notes`).then((r) => r.json()),
        fetch(`${base}/api/memory`).then((r) => r.json()),
      ]);

      const conversation = results[0];

      if (conversation.status === "fulfilled") {
        const stored = conversation.value?.messages || [];

        if (stored.length > 0) {
          setMessages([
            {
              role: "assistant",
              content: "Welcome back. What would you like to do?",
            },
            ...stored,
          ]);
        }
      }

      if (results[1].status === "fulfilled") {
        setReminders(results[1].value?.reminders || []);
      }

      if (results[2].status === "fulfilled") {
        setNotes(results[2].value?.notes || []);
      }

      if (results[3].status === "fulfilled") {
        setMemory(results[3].value?.facts || []);
      }
    } catch (error) {
      console.error("Data loading error:", error);
    }
  }

  async function sendToBackend(text) {
    const response = await fetch(`${getApiBase()}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: text,
      }),
    });

    let data = {};

    try {
      data = await response.json();
    } catch {
      throw new Error(
        `Server returned ${response.status} without valid JSON.`
      );
    }

    if (!response.ok) {
      throw new Error(
        data.error || `Server returned HTTP ${response.status}.`
      );
    }

    return data;
  }

  function speak(text) {
    if (!voiceEnabled || !window.speechSynthesis) return;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;

    window.speechSynthesis.speak(utterance);
  }

  async function handleSend(event) {
    event?.preventDefault();

    const text = input.trim();

    if (!text || busy) return;

    setInput("");

    setMessages((previous) => [
      ...previous,
      {
        role: "user",
        content: text,
      },
    ]);

    // Important:
    // Local commands are handled WITHOUT sending anything to an LLM.
    const localResult = runLocalCommand(text);

    if (localResult) {
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: localResult.reply,
        },
      ]);

      speak(localResult.reply);
      return;
    }

    setBusy(true);

    try {
      const data = await sendToBackend(text);

      if (data.action) {
        handleAction(data.action);
      }

      if (Array.isArray(data.actions)) {
        data.actions.forEach(handleAction);
      }

      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: data.reply || "I received the request but got no response.",
          provider: data.provider,
          model: data.model,
        },
      ]);

      if (data.reply) {
        speak(data.reply);
      }

      if (data.switched) {
        setMessages((previous) => [
          ...previous,
          {
            role: "system",
            content: `I automatically switched to ${data.provider}/${data.model}.`,
          },
        ]);
      }

      await loadData();
    } catch (error) {
      console.error("Chat error:", error);

      setMessages((previous) => [
        ...previous,
        {
          role: "system",
          content: `Request failed: ${error.message}`,
        },
      ]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function handleAction(action) {
    if (!action) return;

    if (action.type === "open_url" && action.url) {
      const success = openUrl(action.url);

      if (!success) {
        setMessages((previous) => [
          ...previous,
          {
            role: "system",
            content:
              "Your browser blocked the popup. Please allow popups for Aria.",
          },
        ]);
      }
    }
  }

  function startVoice() {
    if (!speechSupported || busy || listening) return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    const recognition = new SpeechRecognition();

    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setListening(true);
    };

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();

      if (transcript) {
        setInput(transcript);

        setTimeout(() => {
          handleSend();
        }, 50);
      }
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition:", event.error);
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (error) {
      console.error(error);
      setListening(false);
    }
  }

  async function clearConversation() {
    try {
      await fetch(`${getApiBase()}/api/conversation/clear`, {
        method: "POST",
      });
    } catch (error) {
      console.error(error);
    }

    setMessages([
      {
        role: "assistant",
        content: "Conversation cleared. What shall we do next?",
      },
    ]);
  }

  async function deleteNote(id) {
    try {
      const response = await fetch(`${getApiBase()}/api/notes/${id}`, {
        method: "DELETE",
      });

      const data = await response.json();
      setNotes(data.notes || []);
    } catch (error) {
      console.error(error);
    }
  }

  async function deleteReminder(id) {
    try {
      const response = await fetch(`${getApiBase()}/api/reminders/${id}`, {
        method: "DELETE",
      });

      const data = await response.json();
      setReminders(data.reminders || []);
    } catch (error) {
      console.error(error);
    }
  }

  async function deleteMemory(id) {
    try {
      const response = await fetch(`${getApiBase()}/api/memory/${id}`, {
        method: "DELETE",
      });

      const data = await response.json();
      setMemory(data.facts || []);
    } catch (error) {
      console.error(error);
    }
  }

  function saveSettings() {
    const clean = serverUrl.trim().replace(/\/+$/, "");

    if (clean) {
      localStorage.setItem(API_KEY, clean);
    } else {
      localStorage.removeItem(API_KEY);
    }

    setSettingsOpen(false);

    setTimeout(() => {
      checkHealth();
      loadData();
    }, 100);
  }

  return (
    <div className="aria-app">
      <header className="topbar">
        <div className="brand-area">
          <button
            className="mobile-menu-button"
            onClick={() => setSidebarOpen((value) => !value)}
          >
            ☰
          </button>

          <div className="brand-mark">
            A
          </div>

          <div>
            <div className="brand-title">ARIA</div>
            <div className="brand-subtitle">AI VOICE COMPANION</div>
          </div>
        </div>

        <div className="topbar-right">
          <div className={`connection ${connected ? "online" : "offline"}`}>
            <span className="connection-dot" />
            {connected ? "Connected" : "Offline"}
          </div>

          <button
            className="icon-button"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
          >
            ⚙
          </button>
        </div>
      </header>

      <div className="app-body">
        <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
          <button
            className="new-chat"
            onClick={clearConversation}
          >
            <span>＋</span>
            New conversation
          </button>

          <div className="sidebar-section">
            <div className="sidebar-heading">Workspace</div>

            <button
              className={`sidebar-item ${
                panel === "reminders" ? "active" : ""
              }`}
              onClick={() => setPanel("reminders")}
            >
              <span>⏰</span>
              Reminders
              <span className="count">{reminders.length}</span>
            </button>

            <button
              className={`sidebar-item ${
                panel === "notes" ? "active" : ""
              }`}
              onClick={() => setPanel("notes")}
            >
              <span>📝</span>
              Notes
              <span className="count">{notes.length}</span>
            </button>

            <button
              className={`sidebar-item ${
                panel === "memory" ? "active" : ""
              }`}
              onClick={() => setPanel("memory")}
            >
              <span>🧠</span>
              Memory
              <span className="count">{memory.length}</span>
            </button>
          </div>

          <div className="sidebar-bottom">
            <div className="model-status">
              <div className="model-status-title">
                AI routing
              </div>

              <div className="model-status-value">
                {health?.lastUsed || "Waiting for request"}
              </div>

              <div className="model-status-small">
                {health?.configuredProviders?.length || 0} provider(s)
                configured
              </div>
            </div>

            <button
              className="sidebar-clear"
              onClick={clearConversation}
            >
              Clear conversation
            </button>
          </div>
        </aside>

        <main className="main-area">
          <section className="chat-section">
            <div className="chat-header">
              <div>
                <h2>Conversation</h2>
                <p>
                  {busy
                    ? "Aria is thinking..."
                    : listening
                    ? "Listening..."
                    : "Ready when you are"}
                </p>
              </div>

              <div className="chat-state">
                <span
                  className={`state-dot ${
                    busy || listening ? "active" : ""
                  }`}
                />
                {busy
                  ? "Thinking"
                  : listening
                  ? "Listening"
                  : "Ready"}
              </div>
            </div>

            <div className="messages-container">
              <div className="messages">
                {messages.map((message, index) => (
                  <Message
                    key={`${index}-${message.role}`}
                    message={message}
                  />
                ))}

                {busy && (
                  <div className="message-row assistant-row">
                    <div className="message assistant-message thinking-message">
                      <div className="message-label">ARIA</div>

                      <div className="thinking-dots">
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            <div className="composer-area">
              <form className="composer" onSubmit={handleSend}>
                <button
                  type="button"
                  className={`voice-button ${
                    listening ? "listening" : ""
                  }`}
                  onClick={startVoice}
                  disabled={!speechSupported || busy}
                  title={
                    speechSupported
                      ? "Voice input"
                      : "Voice input is not supported"
                  }
                >
                  {listening ? "●" : "🎙"}
                </button>

                <input
                  ref={inputRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder={
                    busy
                      ? "Aria is thinking..."
                      : "Message Aria..."
                  }
                  disabled={busy}
                  autoComplete="off"
                />

                <button
                  type="submit"
                  className="send-button"
                  disabled={!input.trim() || busy}
                >
                  ➤
                </button>
              </form>

              <div className="composer-footer">
                <span>
                  {speechSupported
                    ? "Voice input available"
                    : "Text input"}
                </span>

                <button
                  className={`voice-toggle ${
                    voiceEnabled ? "enabled" : ""
                  }`}
                  onClick={() =>
                    setVoiceEnabled((value) => !value)
                  }
                >
                  {voiceEnabled ? "🔊 Voice on" : "🔇 Voice off"}
                </button>
              </div>
            </div>
          </section>

          <aside className="right-panel">
            <div className="right-panel-header">
              <div>
                <h3>
                  {panel === "reminders"
                    ? "Reminders"
                    : panel === "notes"
                    ? "Notes"
                    : "Memory"}
                </h3>

                <span>
                  {panel === "reminders"
                    ? `${reminders.length} active`
                    : panel === "notes"
                    ? `${notes.length} saved`
                    : `${memory.length} facts`}
                </span>
              </div>
            </div>

            <div className="right-panel-content">
              {panel === "reminders" && (
                <>
                  {reminders.length === 0 ? (
                    <div className="empty-state">
                      <div>⏰</div>
                      <strong>No reminders</strong>
                      <span>
                        Tell Aria something like
                        <br />
                        "remind me in 20 minutes"
                      </span>
                    </div>
                  ) : (
                    reminders.map((reminder) => (
                      <div
                        className="data-card"
                        key={reminder._id || reminder.id}
                      >
                        <div className="data-icon">⏰</div>

                        <div className="data-main">
                          <strong>{reminder.text}</strong>
                          <span>
                            {new Date(
                              reminder.dueAt
                            ).toLocaleString()}
                          </span>
                        </div>

                        <button
                          onClick={() =>
                            deleteReminder(
                              reminder._id || reminder.id
                            )
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))
                  )}
                </>
              )}

              {panel === "notes" && (
                <>
                  {notes.length === 0 ? (
                    <div className="empty-state">
                      <div>📝</div>
                      <strong>No notes</strong>
                      <span>
                        Tell Aria "take a note that..."
                      </span>
                    </div>
                  ) : (
                    notes.map((note) => (
                      <div
                        className="data-card"
                        key={note._id || note.id}
                      >
                        <div className="data-icon">📝</div>

                        <div className="data-main">
                          <strong>{note.text}</strong>
                          <span>
                            {new Date(
                              note.createdAt
                            ).toLocaleString()}
                          </span>
                        </div>

                        <button
                          onClick={() =>
                            deleteNote(note._id || note.id)
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))
                  )}
                </>
              )}

              {panel === "memory" && (
                <>
                  {memory.length === 0 ? (
                    <div className="empty-state">
                      <div>🧠</div>
                      <strong>No memories</strong>
                      <span>
                        Tell Aria "remember that..."
                      </span>
                    </div>
                  ) : (
                    memory.map((fact) => (
                      <div
                        className="data-card"
                        key={fact._id || fact.id}
                      >
                        <div className="data-icon">🧠</div>

                        <div className="data-main">
                          <strong>{fact.fact}</strong>
                          <span>
                            {new Date(
                              fact.createdAt
                            ).toLocaleString()}
                          </span>
                        </div>

                        <button
                          onClick={() =>
                            deleteMemory(
                              fact._id || fact.id
                            )
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))
                  )}
                </>
              )}
            </div>
          </aside>
        </main>
      </div>

      {settingsOpen && (
        <div
          className="modal-overlay"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="settings-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h3>Connection settings</h3>
                <p>Configure your Aria backend URL.</p>
              </div>

              <button onClick={() => setSettingsOpen(false)}>
                ×
              </button>
            </div>

            <label>Backend URL</label>

            <input
              value={serverUrl}
              onChange={(event) =>
                setServerUrl(event.target.value)
              }
              placeholder="https://your-server.onrender.com"
            />

            <div className="modal-help">
              Your Vercel deployment should normally use the
              VITE_API_URL environment variable.
            </div>

            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => setSettingsOpen(false)}
              >
                Cancel
              </button>

              <button
                className="primary-button"
                onClick={saveSettings}
              >
                Save & reconnect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}