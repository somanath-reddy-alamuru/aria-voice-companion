# Aria — Voice Companion

## Debugging pass — Sept 2026

Three real bugs fixed this round:

1. **"Open X" did nothing.** `window.open()` only succeeds when called
   synchronously inside a real click — any open that happened *after* the
   `await` to Gemini (i.e. basically every non-trivial request) was being
   silently eaten by the popup blocker. `App.jsx` now tries the open and,
   if the browser refused it, drops a tappable button in the chat instead
   of failing silently — a real click always gets through.
2. **Wake-word mode acting up after Aria replies.** The continuous mic was
   never paused while Aria's TTS was actually talking, so it could hear
   its own voice come back through the speakers and misread it as your
   next command. `speak()` now pauses wake-word listening while talking
   and resumes it right after.
3. **`gemini-2.0-flash` fallback.** That model was retired in early 2026;
   swapped for `gemini-2.5-flash` in `server/index.js`.

**Not a code bug — a plan mismatch:** a Google AI Pro/Ultra subscription
(the consumer Gemini app) is a completely separate product from the
Gemini *Developer* API key this server uses. The API key runs on its own
Free Tier (tight per-minute/per-day caps) regardless of any Pro/Ultra
subscription on the same Google account. To get real headroom, enable
billing on the project behind your API key in Google AI Studio /
Google Cloud Console — that moves you to a paid usage tier with much
higher limits, still cheap for a personal project's volume.


A JARVIS-style voice assistant: wake-word activated, talks back like a person,
holds a real conversation, remembers things about you across sessions, and
can actually *do* things you ask — open sites, search, play a song on
YouTube, check weather/time, do math, look things up, set reminders, jot
notes, draft emails, get directions, and chain multiple actions in one
request. Built to double as an HR-interview and communication-skills
practice partner.

## What changed in this pass

- **Mic reliability fixes.** Tap-to-talk and wake-word listening used to be
  able to fight over the single mic session a browser allows, which is the
  most common reason it looked like Aria "wasn't listening." Tap-to-talk now
  pauses wake-word mode for one capture and resumes it automatically
  afterward, event handlers are attached before `recognition.start()` (no
  more race with the mic opening), and wake-word restarts have a short
  backoff so Chrome doesn't throttle rapid restarts into silent failure.
- **No more holding anything.** There was never a real "hold" requirement in
  this codebase (the button is a single tap), but it's now relabeled **Tap
  to Talk** and made robust so a single click reliably captures one
  utterance and stops itself — no press-and-hold, which doesn't translate to
  a laptop trackpad/keyboard anyway.
- **A much bigger tool set** — see the table below. Aria can now check
  weather and time anywhere, do arithmetic, pull a Wikipedia summary or a
  dictionary definition, set and deliver reminders, take notes, open a
  pre-filled Gmail draft, and get Maps directions — all chainable in one
  request, all without needing extra paid API keys.
- **Model auto-fallback.** If the pinned Gemini model name gets retired
  (this has already happened once — see the bottom of this file), the
  server now tries a short list of current model names automatically
  instead of every request just failing until someone edits a string.
- **Neuron-field UI.** The background is now a live animated node/edge
  network (canvas, no extra libraries) that speeds up and glows brighter as
  Aria goes from idle → listening → thinking → speaking, so the whole page
  reacts, not just the orb.
- **Reminders & notes panel.** A small side panel (🗒️ button, top right)
  shows pending reminders and saved notes, refreshing automatically and the
  moment a reminder comes due, Aria speaks it unprompted.

## How it's structured

```
aria-project/
├── server/                Node/Express backend — the "brain" + memory
│   ├── index.js             the agentic loop: talks to Gemini, runs tools, saves history
│   ├── tools.js              the actions Aria is allowed to take (open a site, play YouTube, remember a fact...)
│   ├── store.js              reads/writes the JSON files below
│   ├── data/
│   │   ├── conversation.json    full chat history, persists across restarts
│   │   └── memory.json          long-term facts Aria has chosen to remember about you
│   ├── package.json
│   └── .env.example
└── client/                Vite + React frontend — the voice UI
    ├── src/
    │   ├── App.jsx           orb, mic, chat log, wake-word logic
    │   ├── main.jsx
    │   └── index.css
    ├── index.html
    └── package.json
```

Why a backend at all? The browser can't safely hold a secret API key —
anyone could open dev tools and steal it. The server also runs the actual
"thinking loop" and keeps the persistent files, so your history and memory
live in one place instead of being trapped in a browser tab.

## How the agentic part works

When you say something like *"open YouTube and play believer"*, this happens:

1. Client sends your message to the server.
2. Server sends it to Gemini along with a list of **tools** it's allowed to
   use (`open_website`, `youtube_play`, `web_search`, `remember_fact`).
3. Gemini decides to call `youtube_play({ query: "believer" })` instead of
   just replying with text.
4. The server actually runs that tool — searches YouTube (if you've set up
   `YOUTUBE_API_KEY`) or builds a search URL — and reports the result back
   to Gemini.
5. Gemini can chain more tool calls here (this is the "inner loop" — up to
   `MAX_TOOL_ITERATIONS` in `server/index.js`, default 5) or wrap up with a
   spoken reply like *"Playing Believer for you now."*
6. The server sends back `{ reply, actions }` — the client speaks the reply
   and executes each action (`window.open(url)`), since only the browser
   can actually open a tab.

This is the same pattern real agentic AI products use (tool/function
calling plus an execution loop) — just scoped to what a webpage can safely do.

## Where things are stored

- **`server/data/conversation.json`** — every message, forever, until you
  clear it (the trash-can button in the app, or delete the file). This is
  what makes it remember what you were just talking about even after a
  server restart.
- **`server/data/memory.json`** — separate from the transcript: durable
  facts Aria decides are worth keeping long-term (using the `remember_fact`
  tool), like your name or a stated preference. These get quietly injected
  into every conversation so it "just knows" them, the way ChatGPT/Claude's
  memory feature works.
- Both are plain JSON files, gitignored by default (`server/data/*.json`)
  since they're personal — don't commit them if you push this to GitHub.

## 1. Get an API key

Go to https://aistudio.google.com/apikey, sign in with your Google account,
and create an API key. Gemini has a genuinely free tier (rate-limited), so
you can run this without billing set up.

**Optional but recommended:** for Aria to auto-play the *exact* song/video
instead of just opening search results, get a free YouTube Data API v3 key
at https://console.cloud.google.com (enable "YouTube Data API v3" then
create an API key under Credentials). Without it, "play X" still works, it
just opens YouTube's search results page instead of pressing play for you.

## 2. Set up the server

```bash
cd server
npm install
cp .env.example .env
```

Open `.env` and fill it in:
```
GEMINI_API_KEY=AIxxxxxxxxxxxxxxxxxxxx
PORT=3001
YOUTUBE_API_KEY=          # optional, see above
```

Start it:
```bash
npm run dev
```
You should see `Aria server listening on http://localhost:3001`.

## 3. Set up the client

In a **new terminal tab**:
```bash
cd client
npm install
npm run dev
```
Open the URL it prints (usually http://localhost:5173).

## 4. Use it

- **Chrome or Edge only** — voice features use the Web Speech API, which
  Firefox/Safari don't fully support.
- Click **"Hold-free Talk"** to speak once, or turn on **wake-word mode**
  and say "Aria" any time.
- Type instead of talking if you'd rather — both show up in the same chat.
- Try chained requests: *"Aria, open YouTube and play believer by imagine
  dragons"*, *"remember that I prefer short answers"*, *"search for react
  useEffect cleanup"*.
- **Clear conversation** wipes the visible chat and `conversation.json`,
  but keeps long-term memory facts — those need to be removed from
  `memory.json` directly if you want a clean slate.

## Everything Aria can do right now

| Ask for... | Tool | Needs a key? |
|---|---|---|
| "open github" / "open notion.so" | `open_website` | no |
| "play believer by imagine dragons" | `youtube_play` | works without a key (opens search results); set `YOUTUBE_API_KEY` to auto-play the exact video |
| "search the web for X" | `web_search` | no |
| "what's the weather in Kozhikode" | `get_weather` | no (Open-Meteo, free, no key) |
| "what time is it in Tokyo" | `get_time` | no |
| "what's 18% of 2400" | `calculate` | no |
| "who was Alan Turing" | `wikipedia_summary` | no |
| "define ubiquitous" | `define_word` | no |
| "remind me to submit the form in 30 minutes" | `set_reminder` / `list_reminders` | no |
| "take a note that..." / "what are my notes" | `take_note` / `list_notes` | no |
| "email my professor about..." | `compose_email` | no (opens a pre-filled Gmail draft — you still hit send) |
| "directions to the airport" | `get_directions` | no |
| "remember that I prefer short answers" | `remember_fact` | no |

Reminders are delivered even if you're not actively chatting — the client
polls the server every 20s and speaks any reminder whose time has come.

## Known limitations (and what fixes each one)

| Limitation | Why | Fix |
|---|---|---|
| Only listens/reminds while the tab is open | Browsers can't run background code when closed | Package as an Electron desktop app |
| Can't control tabs/pages already open | Browser security sandboxing | Build a Chrome extension with the `tabs`/`scripting` permissions |
| Can't actually send Gmail (only drafts it) | Sending needs OAuth, not just a link | Add Gmail API OAuth + a `send_email` tool in `tools.js` |
| "Play X" opens search results, not the video | No `YOUTUBE_API_KEY` set | Add the key — see step 1 above |
| Voice sounds robotic | Using free browser TTS | Swap in ElevenLabs or OpenAI TTS API (a few lines in `App.jsx`'s `speak()`) |
| Single shared history (no per-user accounts) | Built for one personal user | Add a `sessionId`/login and key the JSON files (or a real DB) by user |

## Adding a new tool (this is how you extend "what Aria can do")

Every capability Aria has is one entry in `TOOLS` (`server/tools.js`) plus
a `case` in `runTool()`. To add a new one — say, checking the weather:

1. Add a `functionDeclarations` entry describing it (name, description,
   parameters) so Gemini knows it exists and when to use it.
2. Add a `case "get_weather":` in `runTool()` that actually calls a
   weather API and returns `{ functionResponse, action }`.
3. That's it — Gemini will start calling it automatically when relevant,
   and it can be chained with other tools in the same request.

## Customizing Aria's personality

Edit `basePersonality()` in `server/index.js` — that's the entire
personality and behavior definition, plus where long-term memory facts get
injected into the conversation.

## Changing the Gemini model

`MODEL_CANDIDATES` near the top of `server/index.js` is a short list Aria
tries in order (`gemini-3.6-flash`, then a couple of older fallbacks), and
it remembers whichever one actually responds so it doesn't re-probe on
every request. Google periodically retires model names (this project has
already had `gemini-2.5-flash` retired once) — if every candidate 404s,
add whatever model name the error message points you to, either as a new
entry in `MODEL_CANDIDATES` or by setting `GEMINI_MODEL=` in `.env` to pin
one directly. Note that Gemini 3.x tightened the function-calling contract
compared to 2.x: every `functionResponse` must carry the matching call
`id`, and the model's own turn must be echoed back untouched (to preserve
its internal `thoughtSignature`) — both are already handled in
`server/index.js`, but worth knowing if you modify that loop.
