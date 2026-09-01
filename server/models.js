import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  name: { type: String, required: true },
  avatar: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
});

const MessageSchema = new mongoose.Schema({
  role: { type: String, required: true },
  content: { type: String, default: "" },
  tool_calls: { type: Array, default: [] },
  tool_call_id: { type: String, default: null },
  name: { type: String, default: null },
  timestamp: { type: Date, default: Date.now },
});

const SessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  title: { type: String, required: true, default: "New Conversation" },
  messages: [MessageSchema],
  updatedAt: { type: Date, default: Date.now },
});

const MemorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  fact: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const ReminderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text: { type: String, required: true },
  dueAt: { type: Date, required: true },
  delivered: { type: Boolean, default: false },
});

const NoteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

export const User = mongoose.model("User", UserSchema);
export const Session = mongoose.model("Session", SessionSchema);
export const Memory = mongoose.model("Memory", MemorySchema);
export const Reminder = mongoose.model("Reminder", ReminderSchema);
export const Note = mongoose.model("Note", NoteSchema);