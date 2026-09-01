import mongoose from "mongoose";

const MessageSchema = new mongoose.Schema({
  role: { type: String, required: true },
  content: { type: String, default: "" },
  tool_calls: { type: Array, default: [] },
  tool_call_id: { type: String, default: null },
  name: { type: String, default: null },
  timestamp: { type: Date, default: Date.now },
});

const SessionSchema = new mongoose.Schema({
  title: { type: String, required: true, default: "New Conversation" },
  messages: [MessageSchema],
  updatedAt: { type: Date, default: Date.now },
});

export const Session = mongoose.model("Session", SessionSchema);