import { useEffect, useRef, useState } from "react";

const API_STORAGE_KEY = "aria_server_url";

function getApiBase() {
  const saved = localStorage.getItem(API_STORAGE_KEY);

  if (saved) {
    return saved.replace(/\/+$/, "");
  }

  const envUrl = import.meta.env.VITE_API_URL;

  if (envUrl) {
    return envUrl.replace(/\/+$/, "");
  }

  if (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  ) {
    return "http://localhost:3001";
  }

  return "";
}

function openUrl(url) {
  const popup = window.open(
    url,
    "_blank",
    "noopener,noreferrer"
  );

  return Boolean(popup);
}

/*
|--------------------------------------------------------------------------
| LOCAL COMMANDS
|--------------------------------------------------------------------------
|
| These commands NEVER go to an LLM.
|
| This prevents unnecessary API usage.
|
*/

function runLocalCommand(text) {
  const value = text.trim();
  const lower = value.toLowerCase();

  /*
  Calculator
  */

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

      const result = Function(
        `"use strict"; return (${expression})`
      )();

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

  /*
  Current time
  */

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

  /*
  Current date
  */

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

  /*
  Open websites
  */

  const openMatch = lower.match(
    /^(?:open|launch|go to)\s+(.+)$/
  );

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
          : "Your browser blocked the popup. Please allow popups.",
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

  /*
  Google search
  */

  let match = lower.match(
    /^search (?:google|the web) for (.+)$/
  );

  if (match) {
    const query = match[1].trim();

    const url =
      `https://www.google.com/search?q=` +
      encodeURIComponent(query);

    const success = openUrl(url);

    return {
      reply: success
        ? `Searching Google for "${query}".`
        : "Your browser blocked the popup.",
      local: true,
    };
  }

  /*
  YouTube search
  */

  match = lower.match(
    /^search youtube for (.+)$/
  );

  if (match) {
    const query = match[1].trim();

    const url =
      `https://www.youtube.com/results?search_query=` +
      encodeURIComponent(query);

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

/*
|--------------------------------------------------------------------------
| MESSAGE
|--------------------------------------------------------------------------
*/

function Message({ message }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  return (
    <div
      className={`message-row ${
        isUser
          ? "user-row"
          : isSystem
          ? "system-row"
          : "assistant-row"
      }`}
    >
      <div
        className={`message ${
          isUser
            ? "user-message"
            : isSystem
            ? "system-message"
            : "assistant-message"
        }`}
      >
        {!isUser && (
          <div className="message-label">
            {isSystem ? "SYSTEM" : "ARIA"}
          </div>
        )}

        <div className="message-text">
          {message.content}
        </div>

        {!isUser && message.provider && (
          <div className="message-meta">
            {message.provider}/{message.model}
          </div>
        )}
      </div>
    </div>
  );
}

/*
|--------------------------------------------------------------------------
| APP
|--------------------------------------------------------------------------
*/

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

  const [connected, setConnected] =
    useState(false);

  const [health, setHealth] =
    useState(null);

  const [sidebarOpen, setSidebarOpen] =
    useState(false);

  const [settingsOpen, setSettingsOpen] =
    useState(false);

  const [serverUrl, setServerUrl] =
    useState(getApiBase());

  const [reminders, setReminders] =
    useState([]);

  const [notes, setNotes] =
    useState([]);

  const [memory, setMemory] =
    useState([]);

  const [panel, setPanel] =
    useState("reminders");

  /*
  Voice settings
  */

  const [voiceEnabled, setVoiceEnabled] =
    useState(true);

  const [continuousVoice, setContinuousVoice] =
    useState(false);

  const [listening, setListening] =
    useState(false);

  const [speaking, setSpeaking] =
    useState(false);

  const messagesEndRef =
    useRef(null);

  const recognitionRef =
    useRef(null);

  const inputRef =
    useRef(null);

  const continuousVoiceRef =
    useRef(false);

  const busyRef =
    useRef(false);

  const speechSupported =
    typeof window !== "undefined" &&
    Boolean(
      window.SpeechRecognition ||
        window.webkitSpeechRecognition
    );

  /*
  Keep refs synchronized.
  */

  useEffect(() => {
    continuousVoiceRef.current =
      continuousVoice;
  }, [continuousVoice]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  /*
  Auto-scroll.
  */

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages, busy]);

  /*
  Initial loading.
  */

  useEffect(() => {
    checkHealth();
    loadData();

    return () => {
      stopVoiceRecognition();

      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  /*
  Health check
  */

  async function checkHealth() {
    const base = getApiBase();

    if (!base) {
      setConnected(false);
      setHealth(null);
      return;
    }

    try {
      const response = await fetch(
        `${base}/health`,
        {
          cache: "no-store",
        }
      );

      if (!response.ok) {
        throw new Error(
          `Health check failed: ${response.status}`
        );
      }

      const data = await response.json();

      setHealth(data);
      setConnected(Boolean(data.ok));
    } catch (error) {
      console.error(
        "Health check error:",
        error
      );

      setConnected(false);
      setHealth(null);
    }
  }

  /*
  Load MongoDB data.
  */

  async function loadData() {
    const base = getApiBase();

    if (!base) return;

    const endpoints = [
      `${base}/api/conversation`,
      `${base}/api/reminders`,
      `${base}/api/notes`,
      `${base}/api/memory`,
    ];

    const results =
      await Promise.allSettled(
        endpoints.map((url) =>
          fetch(url).then((response) => {
            if (!response.ok) {
              throw new Error(
                `${response.status}`
              );
            }

            return response.json();
          })
        )
      );

    if (
      results[0]?.status ===
      "fulfilled"
    ) {
      const stored =
        results[0].value?.messages || [];

      if (stored.length > 0) {
        setMessages([
          {
            role: "assistant",
            content:
              "Welcome back. What would you like to do?",
          },
          ...stored,
        ]);
      }
    }

    if (
      results[1]?.status ===
      "fulfilled"
    ) {
      setReminders(
        results[1].value?.reminders || []
      );
    }

    if (
      results[2]?.status ===
      "fulfilled"
    ) {
      setNotes(
        results[2].value?.notes || []
      );
    }

    if (
      results[3]?.status ===
      "fulfilled"
    ) {
      setMemory(
        results[3].value?.facts || []
      );
    }
  }

  /*
  Send message to backend.
  */

  async function sendToBackend(text) {
    const base = getApiBase();

    if (!base) {
      throw new Error(
        "Backend URL is not configured."
      );
    }

    const response = await fetch(
      `${base}/api/chat`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          message: text,
        }),
      }
    );

    let data = {};

    try {
      data = await response.json();
    } catch {
      throw new Error(
        `Server returned HTTP ${response.status} with an invalid response.`
      );
    }

    if (!response.ok) {
      throw new Error(
        data.error ||
          `Server returned HTTP ${response.status}.`
      );
    }

    return data;
  }

  /*
  Speak AI response.
  */

  function speak(text) {
    if (
      !voiceEnabled ||
      !window.speechSynthesis ||
      !text
    ) {
      return;
    }

    window.speechSynthesis.cancel();

    const utterance =
      new SpeechSynthesisUtterance(text);

    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;

    utterance.onstart = () => {
      setSpeaking(true);
    };

    utterance.onend = () => {
      setSpeaking(false);

      /*
      After Aria finishes speaking,
      continuous mode listens again.
      */

      if (
        continuousVoiceRef.current &&
        !busyRef.current
      ) {
        setTimeout(() => {
          startVoiceRecognition();
        }, 400);
      }
    };

    utterance.onerror = () => {
      setSpeaking(false);

      if (
        continuousVoiceRef.current &&
        !busyRef.current
      ) {
        setTimeout(() => {
          startVoiceRecognition();
        }, 500);
      }
    };

    window.speechSynthesis.speak(
      utterance
    );
  }

  /*
  Stop speech.
  */

  function stopSpeaking() {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    setSpeaking(false);
  }

  /*
  Handle AI actions.
  */

  function handleAction(action) {
    if (!action) return;

    if (
      action.type === "open_url" &&
      action.url
    ) {
      const success = openUrl(
        action.url
      );

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

  /*
  SEND
  */

  async function handleSend(
    event,
    voiceText = null
  ) {
    if (event) {
      event.preventDefault();
    }

    const text = (
      voiceText !== null
        ? voiceText
        : input
    ).trim();

    if (!text || busy) {
      return;
    }

    setInput("");

    setMessages((previous) => [
      ...previous,
      {
        role: "user",
        content: text,
      },
    ]);

    /*
    IMPORTANT:
    Local commands are handled here,
    so they NEVER consume an LLM request.
    */

    const localResult =
      runLocalCommand(text);

    if (localResult) {
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content:
            localResult.reply,
        },
      ]);

      speak(localResult.reply);

      return;
    }

    setBusy(true);

    try {
      const data =
        await sendToBackend(text);

      /*
      Browser actions.
      */

      if (data.action) {
        handleAction(data.action);
      }

      if (
        Array.isArray(data.actions)
      ) {
        data.actions.forEach(
          handleAction
        );
      }

      /*
      Add AI response.
      */

      const reply =
        data.reply ||
        "I received your request but didn't get a response.";

      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: reply,
          provider:
            data.provider,
          model:
            data.model,
        },
      ]);

      /*
      Speak response while keeping
      text visible.
      */

      if (voiceEnabled) {
        speak(reply);
      }

      /*
      Tell user if fallback happened.
      */

      if (data.switched) {
        setMessages((previous) => [
          ...previous,
          {
            role: "system",
            content:
              `The previous model was unavailable, so I automatically switched to ${data.provider}/${data.model}.`,
          },
        ]);
      }

      await loadData();
    } catch (error) {
      console.error(
        "Chat error:",
        error
      );

      setMessages((previous) => [
        ...previous,
        {
          role: "system",
          content:
            `Request failed: ${error.message}`,
        },
      ]);

      /*
      In continuous mode, allow the
      user to speak again after an error.
      */

      if (
        continuousVoiceRef.current
      ) {
        setTimeout(() => {
          startVoiceRecognition();
        }, 700);
      }
    } finally {
      setBusy(false);

      inputRef.current?.focus();
    }
  }

  /*
  Start microphone recognition.
  */

  function startVoiceRecognition() {
    if (
      !speechSupported ||
      busyRef.current
    ) {
      return;
    }

    /*
    Don't create multiple recognition
    sessions.
    */

    if (listening) {
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      return;
    }

    /*
    Stop previous instance.
    */

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }

    const recognition =
      new SpeechRecognition();

    recognition.continuous = false;

    recognition.interimResults =
      false;

    recognition.lang = "en-US";

    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setListening(true);
    };

    recognition.onresult = (
      event
    ) => {
      const transcript =
        event.results?.[0]?.[0]?.transcript?.trim();

      if (!transcript) {
        return;
      }

      /*
      Display recognized text.
      */

      setInput(transcript);

      /*
      Send exactly ONE request.
      */

      setTimeout(() => {
        handleSend(
          null,
          transcript
        );
      }, 100);
    };

    recognition.onerror = (
      event
    ) => {
      console.error(
        "Speech recognition error:",
        event.error
      );

      setListening(false);

      if (
        event.error ===
          "not-allowed" ||
        event.error ===
          "service-not-allowed"
      ) {
        setContinuousVoice(false);
        continuousVoiceRef.current =
          false;
      }
    };

    recognition.onend = () => {
      setListening(false);

      /*
      We intentionally DON'T immediately
      restart here after a transcript.

      handleSend() → AI response →
      speak() → speak.onend →
      startVoiceRecognition()

      This prevents overlapping
      microphone/AI operations.
      */

      if (
        continuousVoiceRef.current &&
        !busyRef.current &&
        !speaking &&
        !input.trim()
      ) {
        /*
        Small safety restart for cases
        where recognition ended without
        producing speech.
        */

        setTimeout(() => {
          if (
            continuousVoiceRef.current &&
            !busyRef.current &&
            !listening
          ) {
            startVoiceRecognition();
          }
        }, 700);
      }
    };

    recognitionRef.current =
      recognition;

    try {
      recognition.start();
    } catch (error) {
      console.error(
        "Unable to start recognition:",
        error
      );

      setListening(false);
    }
  }

  /*
  Stop microphone.
  */

  function stopVoiceRecognition() {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }

    recognitionRef.current =
      null;

    setListening(false);
  }

  /*
  Toggle continuous voice mode.
  */

  function toggleContinuousVoice() {
    if (!speechSupported) {
      return;
    }

    if (
      continuousVoice ||
      listening
    ) {
      setContinuousVoice(false);

      continuousVoiceRef.current =
        false;

      stopVoiceRecognition();

      stopSpeaking();

      return;
    }

    setContinuousVoice(true);

    continuousVoiceRef.current =
      true;

    startVoiceRecognition();
  }

  /*
  Tap-to-talk.
  */

  function tapToTalk() {
    if (!speechSupported || busy) {
      return;
    }

    /*
    If continuous mode is active,
    tap stops it.
    */

    if (continuousVoice) {
      toggleContinuousVoice();
      return;
    }

    if (listening) {
      stopVoiceRecognition();
      return;
    }

    startVoiceRecognition();
  }

  /*
  Clear conversation.
  */

  async function clearConversation() {
    try {
      await fetch(
        `${getApiBase()}/api/conversation/clear`,
        {
          method: "POST",
        }
      );
    } catch (error) {
      console.error(error);
    }

    setMessages([
      {
        role: "assistant",
        content:
          "Conversation cleared. What shall we do next?",
      },
    ]);
  }

  /*
  Delete note.
  */

  async function deleteNote(id) {
    try {
      const response =
        await fetch(
          `${getApiBase()}/api/notes/${id}`,
          {
            method: "DELETE",
          }
        );

      const data =
        await response.json();

      setNotes(data.notes || []);
    } catch (error) {
      console.error(error);
    }
  }

  /*
  Delete reminder.
  */

  async function deleteReminder(id) {
    try {
      const response =
        await fetch(
          `${getApiBase()}/api/reminders/${id}`,
          {
            method: "DELETE",
          }
        );

      const data =
        await response.json();

      setReminders(
        data.reminders || []
      );
    } catch (error) {
      console.error(error);
    }
  }

  /*
  Delete memory.
  */

  async function deleteMemory(id) {
    try {
      const response =
        await fetch(
          `${getApiBase()}/api/memory/${id}`,
          {
            method: "DELETE",
          }
        );

      const data =
        await response.json();

      setMemory(data.facts || []);
    } catch (error) {
      console.error(error);
    }
  }

  /*
  Save backend URL.
  */

  function saveSettings() {
    const clean =
      serverUrl
        .trim()
        .replace(/\/+$/, "");

    if (clean) {
      localStorage.setItem(
        API_STORAGE_KEY,
        clean
      );
    } else {
      localStorage.removeItem(
        API_STORAGE_KEY
      );
    }

    setSettingsOpen(false);

    setTimeout(() => {
      checkHealth();
      loadData();
    }, 100);
  }

  return (
    <div className="aria-app">
      {/* TOP BAR */}

      <header className="topbar">
        <div className="brand-area">
          <button
            className="mobile-menu-button"
            onClick={() =>
              setSidebarOpen(
                (value) => !value
              )
            }
          >
            ☰
          </button>

          <div className="brand-mark">
            A
          </div>

          <div>
            <div className="brand-title">
              ARIA
            </div>

            <div className="brand-subtitle">
              AI VOICE COMPANION
            </div>
          </div>
        </div>

        <div className="topbar-right">
          <div
            className={`connection ${
              connected
                ? "online"
                : "offline"
            }`}
          >
            <span className="connection-dot" />

            {connected
              ? "Connected"
              : "Offline"}
          </div>

          <button
            className="icon-button"
            onClick={() =>
              setSettingsOpen(true)
            }
          >
            ⚙
          </button>
        </div>
      </header>

      {/* BODY */}

      <div className="app-body">
        {/* SIDEBAR */}

        <aside
          className={`sidebar ${
            sidebarOpen ? "open" : ""
          }`}
        >
          <button
            className="new-chat"
            onClick={() => {
              clearConversation();
              setSidebarOpen(false);
            }}
          >
            <span>＋</span>
            New conversation
          </button>

          <div className="sidebar-section">
            <div className="sidebar-heading">
              Workspace
            </div>

            <button
              className={`sidebar-item ${
                panel === "reminders"
                  ? "active"
                  : ""
              }`}
              onClick={() =>
                setPanel("reminders")
              }
            >
              <span>⏰</span>
              Reminders
              <span className="count">
                {reminders.length}
              </span>
            </button>

            <button
              className={`sidebar-item ${
                panel === "notes"
                  ? "active"
                  : ""
              }`}
              onClick={() =>
                setPanel("notes")
              }
            >
              <span>📝</span>
              Notes
              <span className="count">
                {notes.length}
              </span>
            </button>

            <button
              className={`sidebar-item ${
                panel === "memory"
                  ? "active"
                  : ""
              }`}
              onClick={() =>
                setPanel("memory")
              }
            >
              <span>🧠</span>
              Memory
              <span className="count">
                {memory.length}
              </span>
            </button>
          </div>

          <div className="sidebar-bottom">
            <div className="model-status">
              <div className="model-status-title">
                AI routing
              </div>

              <div className="model-status-value">
                {health?.lastUsed ||
                  "Waiting for request"}
              </div>

              <div className="model-status-small">
                {health
                  ?.configuredProviders
                  ?.length || 0}{" "}
                provider(s) configured
              </div>
            </div>

            <button
              className="sidebar-clear"
              onClick={
                clearConversation
              }
            >
              Clear conversation
            </button>
          </div>
        </aside>

        {/* MAIN */}

        <main className="main-area">
          {/* CHAT */}

          <section className="chat-section">
            <div className="chat-header">
              <div>
                <h2>
                  Conversation
                </h2>

                <p>
                  {busy
                    ? "Aria is thinking..."
                    : listening
                    ? "Listening..."
                    : speaking
                    ? "Speaking..."
                    : continuousVoice
                    ? "Voice mode active"
                    : "Ready when you are"}
                </p>
              </div>

              <div className="chat-state">
                <span
                  className={`state-dot ${
                    busy ||
                    listening ||
                    speaking
                      ? "active"
                      : ""
                  }`}
                />

                {busy
                  ? "Thinking"
                  : listening
                  ? "Listening"
                  : speaking
                  ? "Speaking"
                  : continuousVoice
                  ? "Voice"
                  : "Ready"}
              </div>
            </div>

            {/* MESSAGES */}

            <div className="messages-container">
              <div className="messages">
                {messages.map(
                  (message, index) => (
                    <Message
                      key={`${index}-${message.role}`}
                      message={message}
                    />
                  )
                )}

                {busy && (
                  <div className="message-row assistant-row">
                    <div className="message assistant-message thinking-message">
                      <div className="message-label">
                        ARIA
                      </div>

                      <div className="thinking-dots">
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                  </div>
                )}

                <div
                  ref={messagesEndRef}
                />
              </div>
            </div>

            {/* COMPOSER */}

            <div className="composer-area">
              <form
                className="composer"
                onSubmit={handleSend}
              >
                <button
                  type="button"
                  className={`voice-button ${
                    listening
                      ? "listening"
                      : ""
                  } ${
                    continuousVoice
                      ? "continuous"
                      : ""
                  }`}
                  onClick={
                    tapToTalk
                  }
                  disabled={
                    !speechSupported ||
                    busy
                  }
                  title={
                    continuousVoice
                      ? "Stop voice mode"
                      : "Tap to speak"
                  }
                >
                  {listening
                    ? "●"
                    : "🎙"}
                </button>

                <input
                  ref={inputRef}
                  value={input}
                  onChange={(event) =>
                    setInput(
                      event.target.value
                    )
                  }
                  placeholder={
                    listening
                      ? "Listening..."
                      : busy
                      ? "Aria is thinking..."
                      : continuousVoice
                      ? "Speak naturally..."
                      : "Message Aria..."
                  }
                  disabled={busy}
                  autoComplete="off"
                />

                <button
                  type="submit"
                  className="send-button"
                  disabled={
                    !input.trim() ||
                    busy
                  }
                >
                  ➤
                </button>
              </form>

              <div className="composer-footer">
                <div className="voice-controls">
                  <button
                    className={`voice-toggle ${
                      continuousVoice
                        ? "enabled"
                        : ""
                    }`}
                    onClick={
                      toggleContinuousVoice
                    }
                    disabled={
                      !speechSupported
                    }
                  >
                    {continuousVoice
                      ? "🎙 Continuous voice"
                      : "🎙 Voice mode"}
                  </button>

                  <button
                    className={`voice-toggle ${
                      voiceEnabled
                        ? "enabled"
                        : ""
                    }`}
                    onClick={() => {
                      setVoiceEnabled(
                        (value) =>
                          !value
                      );

                      if (
                        voiceEnabled
                      ) {
                        stopSpeaking();
                      }
                    }}
                  >
                    {voiceEnabled
                      ? "🔊 Speak responses"
                      : "🔇 Text only"}
                  </button>

                  {speaking && (
                    <button
                      className="voice-stop"
                      onClick={
                        stopSpeaking
                      }
                    >
                      Stop speaking
                    </button>
                  )}
                </div>

                <span className="voice-hint">
                  {speechSupported
                    ? continuousVoice
                      ? "Aria listens after each response"
                      : "Tap 🎙 to speak"
                    : "Voice input is not supported by this browser"}
                </span>
              </div>
            </div>
          </section>

          {/* RIGHT PANEL */}

          <aside className="right-panel">
            <div className="right-panel-header">
              <div>
                <h3>
                  {panel ===
                  "reminders"
                    ? "Reminders"
                    : panel === "notes"
                    ? "Notes"
                    : "Memory"}
                </h3>

                <span>
                  {panel ===
                  "reminders"
                    ? `${reminders.length} active`
                    : panel === "notes"
                    ? `${notes.length} saved`
                    : `${memory.length} facts`}
                </span>
              </div>
            </div>

            <div className="right-panel-content">
              {/* REMINDERS */}

              {panel ===
                "reminders" && (
                <>
                  {reminders.length ===
                  0 ? (
                    <div className="empty-state">
                      <div>⏰</div>

                      <strong>
                        No reminders
                      </strong>

                      <span>
                        Tell Aria:
                        <br />
                        "remind me in 20 minutes"
                      </span>
                    </div>
                  ) : (
                    reminders.map(
                      (reminder) => (
                        <div
                          className="data-card"
                          key={
                            reminder._id ||
                            reminder.id
                          }
                        >
                          <div className="data-icon">
                            ⏰
                          </div>

                          <div className="data-main">
                            <strong>
                              {
                                reminder.text
                              }
                            </strong>

                            <span>
                              {new Date(
                                reminder.dueAt
                              ).toLocaleString()}
                            </span>
                          </div>

                          <button
                            onClick={() =>
                              deleteReminder(
                                reminder._id ||
                                  reminder.id
                              )
                            }
                          >
                            ×
                          </button>
                        </div>
                      )
                    )
                  )}
                </>
              )}

              {/* NOTES */}

              {panel === "notes" && (
                <>
                  {notes.length ===
                  0 ? (
                    <div className="empty-state">
                      <div>📝</div>

                      <strong>
                        No notes
                      </strong>

                      <span>
                        Tell Aria:
                        <br />
                        "take a note that..."
                      </span>
                    </div>
                  ) : (
                    notes.map(
                      (note) => (
                        <div
                          className="data-card"
                          key={
                            note._id ||
                            note.id
                          }
                        >
                          <div className="data-icon">
                            📝
                          </div>

                          <div className="data-main">
                            <strong>
                              {note.text}
                            </strong>

                            <span>
                              {new Date(
                                note.createdAt
                              ).toLocaleString()}
                            </span>
                          </div>

                          <button
                            onClick={() =>
                              deleteNote(
                                note._id ||
                                  note.id
                              )
                            }
                          >
                            ×
                          </button>
                        </div>
                      )
                    )
                  )}
                </>
              )}

              {/* MEMORY */}

              {panel === "memory" && (
                <>
                  {memory.length ===
                  0 ? (
                    <div className="empty-state">
                      <div>🧠</div>

                      <strong>
                        No memories
                      </strong>

                      <span>
                        Tell Aria:
                        <br />
                        "remember that..."
                      </span>
                    </div>
                  ) : (
                    memory.map(
                      (fact) => (
                        <div
                          className="data-card"
                          key={
                            fact._id ||
                            fact.id
                          }
                        >
                          <div className="data-icon">
                            🧠
                          </div>

                          <div className="data-main">
                            <strong>
                              {fact.fact}
                            </strong>

                            <span>
                              {new Date(
                                fact.createdAt
                              ).toLocaleString()}
                            </span>
                          </div>

                          <button
                            onClick={() =>
                              deleteMemory(
                                fact._id ||
                                  fact.id
                              )
                            }
                          >
                            ×
                          </button>
                        </div>
                      )
                    )
                  )}
                </>
              )}
            </div>
          </aside>
        </main>
      </div>

      {/* SETTINGS */}

      {settingsOpen && (
        <div
          className="modal-overlay"
          onClick={() =>
            setSettingsOpen(false)
          }
        >
          <div
            className="settings-modal"
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <div className="modal-header">
              <div>
                <h3>
                  Connection settings
                </h3>

                <p>
                  Configure your Aria
                  backend URL.
                </p>
              </div>

              <button
                onClick={() =>
                  setSettingsOpen(false)
                }
              >
                ×
              </button>
            </div>

            <label>
              Backend URL
            </label>

            <input
              value={serverUrl}
              onChange={(event) =>
                setServerUrl(
                  event.target.value
                )
              }
              placeholder="https://your-server.onrender.com"
            />

            <div className="modal-help">
              Normally this should be
              your VITE_API_URL value.
            </div>

            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() =>
                  setSettingsOpen(false)
                }
              >
                Cancel
              </button>

              <button
                className="primary-button"
                onClick={
                  saveSettings
                }
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