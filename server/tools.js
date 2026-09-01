export const TOOLS = [
  {
    type: "function",
    function: {
      name: "open_app_or_url",
      description: "Open a website or application URL.",
      parameters: {
        type: "object",
        properties: { target: { type: "string" } },
        required: ["target"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_reminder",
      description: "Set a reminder or alarm.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          delayMinutes: { type: "number" },
        },
        required: ["text", "delayMinutes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_note",
      description: "Save a note.",
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
      description: "Get weather for a city.",
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

export async function runTool(name, args, userId) {
  if (name === "open_app_or_url") {
    const target = (args.target || "").toLowerCase().trim();
    let url = target;
    if (target.includes("youtube")) url = "https://www.youtube.com";
    else if (target.includes("google")) url = "https://www.google.com";
    else if (!target.startsWith("http")) url = `https://www.google.com/search?q=${encodeURIComponent(target)}`;

    return {
      functionResponse: { status: "success", opened: url },
      action: { type: "open_url", url },
    };
  }

  if (name === "set_reminder") {
    const dueAt = new Date(Date.now() + (args.delayMinutes || 1) * 60000);
    return { functionResponse: { status: "success", text: args.text, dueAt } };
  }

  if (name === "save_note") {
    return { functionResponse: { status: "success", text: args.text } };
  }

  if (name === "remember_fact") {
    return { functionResponse: { status: "success", fact: args.fact } };
  }

  if (name === "get_weather") {
    return { functionResponse: { location: args.location, temperature: "28°C", condition: "Sunny" } };
  }

  if (name === "calculate") {
    try {
      const sanitized = args.expression.replace(/[^0-9+\-*/().%\s]/g, "");
      const result = Function(`'use strict'; return (${sanitized})`)();
      return { functionResponse: { expression: args.expression, result } };
    } catch {
      return { functionResponse: { error: "Invalid math expression" } };
    }
  }

  return { functionResponse: { error: `Unknown tool ${name}` } };
}