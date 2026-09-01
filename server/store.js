import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve("data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const CONV_FILE = path.join(DATA_DIR, "conversation.json");
const MEMORY_FILE = path.join(DATA_DIR, "memory.json");
const REMINDERS_FILE = path.join(DATA_DIR, "reminders.json");
const NOTES_FILE = path.join(DATA_DIR, "notes.json");

// --- CONVERSATION STORE ---
export function loadConversation() {
  try {
    if (fs.existsSync(CONV_FILE)) {
      return JSON.parse(fs.readFileSync(CONV_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error loading conversation:", e);
  }
  return [];
}

export function saveConversation(messages) {
  try {
    fs.writeFileSync(CONV_FILE, JSON.stringify(messages, null, 2));
  } catch (e) {
    console.error("Error saving conversation:", e);
  }
}

export function clearConversation() {
  try {
    if (fs.existsSync(CONV_FILE)) fs.unlinkSync(CONV_FILE);
  } catch (e) {
    console.error("Error clearing conversation:", e);
  }
}

// --- LONG-TERM MEMORY STORE ---
export function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error loading memory:", e);
  }
  return [];
}

export function saveMemoryFact(fact) {
  const facts = loadMemory();
  const newFact = { id: Date.now().toString(), fact, createdAt: new Date().toISOString() };
  facts.push(newFact);
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(facts, null, 2));
  } catch (e) {
    console.error("Error saving memory:", e);
  }
  return newFact;
}

export function deleteMemoryFact(id) {
  let facts = loadMemory();
  facts = facts.filter((f) => f.id !== id);
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(facts, null, 2));
  } catch (e) {
    console.error("Error deleting memory:", e);
  }
  return facts;
}

// --- REMINDERS STORE ---
export function loadReminders() {
  try {
    if (fs.existsSync(REMINDERS_FILE)) {
      return JSON.parse(fs.readFileSync(REMINDERS_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error loading reminders:", e);
  }
  return [];
}

export function saveReminders(reminders) {
  try {
    fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2));
  } catch (e) {
    console.error("Error saving reminders:", e);
  }
}

export function saveReminder(text, dueAt) {
  const reminders = loadReminders();
  const reminder = { id: Date.now().toString(), text, dueAt, delivered: false };
  reminders.push(reminder);
  saveReminders(reminders);
  return reminder;
}

export function getUpcomingReminders() {
  return loadReminders().filter((r) => !r.delivered);
}

export function getDueReminders() {
  const now = new Date();
  const reminders = loadReminders();
  return reminders.filter((r) => !r.delivered && new Date(r.dueAt) <= now);
}

export function markReminderDelivered(id) {
  const reminders = loadReminders();
  const r = reminders.find((item) => item.id === id);
  if (r) {
    r.delivered = true;
    saveReminders(reminders);
  }
}

export function deleteReminder(id) {
  let reminders = loadReminders();
  reminders = reminders.filter((r) => r.id !== id);
  saveReminders(reminders);
}

export function cancelReminderByName(query) {
  const q = query.toLowerCase();
  let reminders = loadReminders();
  const initialCount = reminders.length;
  reminders = reminders.filter((r) => !r.text.toLowerCase().includes(q));
  saveReminders(reminders);
  return initialCount - reminders.length;
}

// --- NOTES STORE ---
export function loadNotes() {
  try {
    if (fs.existsSync(NOTES_FILE)) {
      return JSON.parse(fs.readFileSync(NOTES_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error loading notes:", e);
  }
  return [];
}

export function saveNotes(notes) {
  try {
    fs.writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2));
  } catch (e) {
    console.error("Error saving notes:", e);
  }
}

export function saveNote(text) {
  const notes = loadNotes();
  const note = { id: Date.now().toString(), text, createdAt: new Date().toISOString() };
  notes.push(note);
  saveNotes(notes);
  return note;
}

export function deleteNote(id) {
  let notes = loadNotes();
  notes = notes.filter((n) => n.id !== id);
  saveNotes(notes);
  return notes;
}

export function deleteNoteByName(query) {
  const q = query.toLowerCase();
  let notes = loadNotes();
  const initialCount = notes.length;
  notes = notes.filter((n) => !n.text.toLowerCase().includes(q));
  saveNotes(notes);
  return initialCount - notes.length;
}