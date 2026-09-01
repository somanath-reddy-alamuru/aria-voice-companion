import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const CONVO_FILE = path.join(DATA_DIR, "conversation.json");
const MEMORY_FILE = path.join(DATA_DIR, "memory.json");
const REMINDERS_FILE = path.join(DATA_DIR, "reminders.json");
const NOTES_FILE = path.join(DATA_DIR, "notes.json");

function ensureFile(file, defaultValue) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(defaultValue, null, 2));
}

function readJson(file, defaultValue) {
  ensureFile(file, defaultValue);
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return defaultValue;
  }
}

function writeJson(file, value) {
  ensureFile(file, []);
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

// ---- Conversation history (full transcript, persists across restarts) ----
export function loadConversation() {
  return readJson(CONVO_FILE, []);
}

export function saveConversation(messages) {
  writeJson(CONVO_FILE, messages);
}

export function clearConversation() {
  saveConversation([]);
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ---- Long-term memory (facts Aria decides are worth remembering) ----
// Facts written before this fix may not have an `id` — loadMemory()
// transparently backfills one (and persists it) so every fact is always
// addressable, whether it's brand new or came from an older data file.
export function loadMemory() {
  const facts = readJson(MEMORY_FILE, []);
  let changed = false;
  const withIds = facts.map((f) => {
    if (f.id) return f;
    changed = true;
    return { ...f, id: makeId() };
  });
  if (changed) writeJson(MEMORY_FILE, withIds);
  return withIds;
}

export function addMemoryFact(fact) {
  const facts = loadMemory();
  facts.push({ id: makeId(), fact, savedAt: new Date().toISOString() });
  writeJson(MEMORY_FILE, facts);
  return facts;
}

export function deleteMemoryFact(id) {
  const facts = loadMemory().filter((f) => f.id !== id);
  writeJson(MEMORY_FILE, facts);
  return facts;
}

// Case-insensitive substring match against saved facts — lets a tool call
// like "forget that I mentioned X" resolve to a fact without the model
// needing to know its internal id. Only deletes on an UNAMBIGUOUS match
// (exactly one hit); with 0 or 2+ matches nothing is deleted, and the
// matches are returned so the caller can report/disambiguate.
export function deleteMemoryFactByText(query) {
  const q = String(query || "").toLowerCase().trim();
  const before = loadMemory();
  const matches = before.filter((f) => f.fact.toLowerCase().includes(q));
  if (!q || matches.length !== 1) return { facts: before, deletedCount: 0, matches };
  const remaining = before.filter((f) => f.id !== matches[0].id);
  writeJson(MEMORY_FILE, remaining);
  return { facts: remaining, deletedCount: 1, matches };
}

// ---- Reminders (things Aria should nudge the user about later) ----
export function loadReminders() {
  return readJson(REMINDERS_FILE, []);
}

export function addReminder(text, dueAt) {
  const reminders = loadReminders();
  const reminder = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text,
    dueAt, // ISO string
    createdAt: new Date().toISOString(),
    delivered: false,
  };
  reminders.push(reminder);
  writeJson(REMINDERS_FILE, reminders);
  return reminder;
}

export function getDueReminders() {
  const reminders = loadReminders();
  const now = Date.now();
  return reminders.filter((r) => !r.delivered && new Date(r.dueAt).getTime() <= now);
}

export function markReminderDelivered(id) {
  const reminders = loadReminders();
  const next = reminders.map((r) => (r.id === id ? { ...r, delivered: true } : r));
  writeJson(REMINDERS_FILE, next);
}

export function getUpcomingReminders() {
  return loadReminders()
    .filter((r) => !r.delivered)
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
}

export function deleteReminder(id) {
  const remaining = loadReminders().filter((r) => r.id !== id);
  writeJson(REMINDERS_FILE, remaining);
  return remaining;
}

// Case-insensitive substring match against pending reminders — lets "cancel
// my reminder about X" resolve without the model knowing the internal id.
export function cancelReminderByText(query) {
  const q = String(query || "").toLowerCase().trim();
  const upcoming = getUpcomingReminders();
  const matches = upcoming.filter((r) => r.text.toLowerCase().includes(q));
  if (!q || matches.length === 0) return { reminders: getUpcomingReminders(), cancelledCount: 0, matches: [] };
  const all = loadReminders();
  const matchIds = new Set(matches.map((m) => m.id));
  writeJson(REMINDERS_FILE, all.filter((r) => !matchIds.has(r.id)));
  return { reminders: getUpcomingReminders(), cancelledCount: matches.length, matches };
}

// ---- Notes (freeform things the user asks Aria to jot down) ----
export function loadNotes() {
  return readJson(NOTES_FILE, []);
}

export function addNote(text) {
  const notes = loadNotes();
  const note = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, savedAt: new Date().toISOString() };
  notes.push(note);
  writeJson(NOTES_FILE, notes);
  return note;
}

export function deleteNote(id) {
  const notes = loadNotes().filter((n) => n.id !== id);
  writeJson(NOTES_FILE, notes);
  return notes;
}

// Case-insensitive substring match against saved notes — lets "delete the
// note about X" resolve without the model knowing the internal id.
export function deleteNoteByText(query) {
  const q = String(query || "").toLowerCase().trim();
  const all = loadNotes();
  const matches = all.filter((n) => n.text.toLowerCase().includes(q));
  if (!q || matches.length === 0) return { notes: all, deletedCount: 0, matches: [] };
  const matchIds = new Set(matches.map((m) => m.id));
  const remaining = all.filter((n) => !matchIds.has(n.id));
  writeJson(NOTES_FILE, remaining);
  return { notes: remaining, deletedCount: matches.length, matches };
}