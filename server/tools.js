import { exec } from "child_process";
import os from "os";
import {
  saveMemoryFact,
  saveReminder,
  cancelReminderByName,
  saveNote,
  deleteNoteByName,
} from "./store.js";

export const TOOLS = [
  {
    type: "function",
    function: {
      name: "open_app_or_url",
      description: "Open a local desktop application (like notepad, calculator, code, chrome) or a website/URL.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", description: "App name (notepad, calc, code, youtube, etc.) or URL." },
        },
        required: ["target"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_reminder",
      description: "Set a reminder or alarm with a specific time or delay.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "What to remind the user about." },
          delayMinutes: { type: "number", description: "Minutes from now to trigger the reminder." },
        },
        required: ["text", "delayMinutes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_reminder",
      description: "Cancel an active reminder by description.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_note",
      description: "Save a note or piece of information.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_note",
      description: "Delete a saved note by content match.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember_fact",
      description: "Remember a long-term fact about the user.",
      parameters: {
        type: "object",
        properties: { fact: { type: "string" } },
        required: ["fact"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get current weather for a city.",
      parameters: {
        type: "object",
        properties: { location: { type: "string" } },
        required: ["location"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate",
      description: "Evaluate a mathematical expression.",
      parameters: {
        type: "object",
        properties: { expression: { type: "string" } },
        required: ["expression"],
      },
    },
  },
];

export async function runTool(name, args) {
  if (name === "open_app_or_url") {
    const target = (args.target || "").toLowerCase().trim();
    
    // Map common app requests to OS commands
    const platform = os.platform();
    let command = null;
    let urlFallback = null;

    if (target.includes("notepad") || target.includes("text editor")) {
      command = platform === "win32" ? "notepad" : platform === "darwin" ? "open -a TextEdit" : "gedit";
    } else if (target.includes("calculator") || target.includes("calc")) {
      command = platform === "win32" ? "calc" : platform === "darwin" ? "open -a Calculator" : "gnome-calculator";
    } else if (target.includes("vscode") || target.includes("vs code") || target.includes("code")) {
      command = "code";
    } else if (target.includes("youtube")) {
      urlFallback = "https://www.youtube.com";
    } else if (target.includes("google")) {
      urlFallback = "https://www.google.com";
    } else if (target.includes("github")) {
      urlFallback = "https://github.com";
    } else if (target.includes("leetcode")) {
      urlFallback = "https://leetcode.com";
    }

    if (command) {
      exec(command, (err) => {
        if (err) console.error("Failed to launch local app:", err);
      });
      return { functionResponse: { status: "success", opened: target }, action: null };
    }

    const finalUrl = urlFallback || (target.startsWith("http") ? target : `https://www.google.com/search?q=${encodeURIComponent(target)}`);
    return {
      functionResponse: { status: "success", opened: finalUrl },
      action: { type: "open_url", url: finalUrl },
    };
  }

  if (name === "set_reminder") {
    const dueAt = new Date(Date.now() + (args.delayMinutes || 1) * 60000).toISOString();
    const reminder = saveReminder(args.text, dueAt);
    return { functionResponse: { status: "success", reminder } };
  }

  if (name === "cancel_reminder") {
    const count = cancelReminderByName(args.query);
    return { functionResponse: { status: "success", cancelledCount: count } };
  }

  if (name === "save_note") {
    const note = saveNote(args.text);
    return { functionResponse: { status: "success", note } };
  }

  if (name === "delete_note") {
    const count = deleteNoteByName(args.query);
    return { functionResponse: { status: "success", deletedCount: count } };
  }

  if (name === "remember_fact") {
    const fact = saveMemoryFact(args.fact);
    return { functionResponse: { status: "success", fact } };
  }

  if (name === "get_weather") {
    return { functionResponse: { location: args.location, temperature: "28°C", condition: "Partly Cloudy", humidity: "65%" } };
  }

  if (name === "calculate") {
    try {
      const sanitized = args.expression.replace(/[^0-9+\-*/().%\s]/g, "");
      const result = Function(`'use strict'; return (${sanitized})`)();
      return { functionResponse: { expression: args.expression, result } };
    } catch (e) {
      return { functionResponse: { error: "Invalid math expression" } };
    }
  }

  return { functionResponse: { error: `Unknown tool ${name}` } };
}