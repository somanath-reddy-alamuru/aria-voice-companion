import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";

import {
  TOOLS,
  runTool,
} from "./tools.js";

dotenv.config();

const app = express();

const PORT =
  process.env.PORT || 3001;

const CLIENT_URL = (
  process.env.CLIENT_URL ||
  "*"
).replace(/\/+$/, "");

const HISTORY_WINDOW = 30;

const MAX_TOOL_ITERATIONS = 5;

/*
|--------------------------------------------------------------------------
| CORS
|--------------------------------------------------------------------------
*/

const allowedOrigins =
  CLIENT_URL === "*"
    ? true
    : CLIENT_URL
        .split(",")
        .map((value) =>
          value.trim()
        )
        .filter(Boolean);

app.use(
  cors({
    origin:
      allowedOrigins,

    credentials: false,
  })
);

app.use(
  express.json({
    limit: "1mb",
  })
);

/*
|--------------------------------------------------------------------------
| DATABASE
|--------------------------------------------------------------------------
*/

let mongoReady = false;

const mongoUri =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI;

if (mongoUri) {
  mongoose
    .connect(mongoUri, {
      serverSelectionTimeoutMS:
        10000,
    })
    .then(() => {
      mongoReady = true;

      console.log(
        "MongoDB connected successfully."
      );
    })
    .catch((error) => {
      mongoReady = false;

      console.error(
        "MongoDB connection failed:",
        error.message
      );
    });

  mongoose.connection.on(
    "connected",
    () => {
      mongoReady = true;

      console.log(
        "MongoDB connection established."
      );
    }
  );

  mongoose.connection.on(
    "disconnected",
    () => {
      mongoReady = false;

      console.warn(
        "MongoDB disconnected."
      );
    }
  );

  mongoose.connection.on(
    "error",
    (error) => {
      mongoReady = false;

      console.error(
        "MongoDB error:",
        error.message
      );
    }
  );
} else {
  console.warn(
    "MONGO_URI/MONGODB_URI is not configured. Database features are disabled."
  );
}

/*
|--------------------------------------------------------------------------
| DATABASE SCHEMAS
|--------------------------------------------------------------------------
*/

const conversationSchema =
  new mongoose.Schema(
    {
      messages: {
        type: [
          {
            role: String,

            content: String,

            tool_calls: Array,

            tool_call_id: String,

            name: String,

            timestamp: {
              type: Date,

              default: Date.now,
            },
          },
        ],

        default: [],
      },

      updatedAt: {
        type: Date,

        default: Date.now,
      },
    },

    {
      collection:
        "aria_conversations",
    }
  );

const memorySchema =
  new mongoose.Schema(
    {
      fact: {
        type: String,

        required: true,
      },

      createdAt: {
        type: Date,

        default: Date.now,
      },
    },

    {
      collection:
        "aria_memory",
    }
  );

const reminderSchema =
  new mongoose.Schema(
    {
      text: {
        type: String,

        required: true,
      },

      dueAt: {
        type: Date,

        required: true,
      },

      delivered: {
        type: Boolean,

        default: false,
      },

      createdAt: {
        type: Date,

        default: Date.now,
      },
    },

    {
      collection:
        "aria_reminders",
    }
  );

const noteSchema =
  new mongoose.Schema(
    {
      text: {
        type: String,

        required: true,
      },

      createdAt: {
        type: Date,

        default: Date.now,
      },
    },

    {
      collection:
        "aria_notes",
    }
  );

const Conversation =
  mongoose.models.AriaConversation ||
  mongoose.model(
    "AriaConversation",
    conversationSchema
  );

const Memory =
  mongoose.models.AriaMemory ||
  mongoose.model(
    "AriaMemory",
    memorySchema
  );

const Reminder =
  mongoose.models.AriaReminder ||
  mongoose.model(
    "AriaReminder",
    reminderSchema
  );

const Note =
  mongoose.models.AriaNote ||
  mongoose.model(
    "AriaNote",
    noteSchema
  );

/*
|--------------------------------------------------------------------------
| AI PROVIDERS
|--------------------------------------------------------------------------
|
| ONE request at a time.
|
| A fallback is used ONLY when the previous
| model actually failed.
|
|--------------------------------------------------------------------------
*/

const PROVIDERS = [
  /*
  GROQ
  */

  {
    id: "groq",

    envKey:
      "GROQ_API_KEY",

    kind:
      "openai-compatible",

    baseUrl:
      "https://api.groq.com/openai/v1/chat/completions",

    models: (
      process.env.GROQ_MODELS ||
      "llama-3.3-70b-versatile,llama-3.1-8b-instant"
    )
      .split(",")
      .map((x) =>
        x.trim()
      )
      .filter(Boolean),
  },

  /*
  GEMINI

  Do NOT use gemini-2.5-flash
  as your current default.

  Your previous Render error came from
  that model.
  */

  {
    id: "gemini",

    envKey:
      "GEMINI_API_KEY",

    kind: "gemini",

    models: (
      process.env.GEMINI_MODELS ||
      "gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite"
    )
      .split(",")
      .map((x) =>
        x.trim()
      )
      .filter(Boolean),
  },

  /*
  OPENROUTER
  */

  {
    id: "openrouter",

    envKey:
      "OPENROUTER_API_KEY",

    kind:
      "openai-compatible",

    baseUrl:
      "https://openrouter.ai/api/v1/chat/completions",

    models: (
      process.env.OPENROUTER_MODELS ||
      "openrouter/free"
    )
      .split(",")
      .map((x) =>
        x.trim()
      )
      .filter(Boolean),

    extraHeaders: {
      "HTTP-Referer":
        process.env.CLIENT_URL ||
        "https://aria.app",

      "X-Title":
        "Aria AI Companion",
    },
  },

  /*
  CEREBRAS
  */

  {
    id: "cerebras",

    envKey:
      "CEREBRAS_API_KEY",

    kind:
      "openai-compatible",

    baseUrl:
      "https://api.cerebras.ai/v1/chat/completions",

    models: (
      process.env.CEREBRAS_MODELS ||
      "llama-3.3-70b"
    )
      .split(",")
      .map((x) =>
        x.trim()
      )
      .filter(Boolean),
  },

  /*
  OPENAI
  */

  {
    id: "openai",

    envKey:
      "OPENAI_API_KEY",

    kind:
      "openai-compatible",

    baseUrl:
      "https://api.openai.com/v1/chat/completions",

    models: (
      process.env.OPENAI_MODELS ||
      "gpt-4o-mini"
    )
      .split(",")
      .map((x) =>
        x.trim()
      )
      .filter(Boolean),
  },

  /*
  XAI
  */

  {
    id: "xai",

    envKey:
      "XAI_API_KEY",

    kind:
      "openai-compatible",

    baseUrl:
      "https://api.x.ai/v1/chat/completions",

    models: (
      process.env.XAI_MODELS ||
      "grok-3"
    )
      .split(",")
      .map((x) =>
        x.trim()
      )
      .filter(Boolean),
  },
].filter(
  (provider) =>
    process.env[
      provider.envKey
    ] &&
    provider.models.length >
      0
);

/*
|--------------------------------------------------------------------------
| MODEL COOLDOWNS
|--------------------------------------------------------------------------
*/

const cooldownUntil =
  new Map();

const RATE_LIMIT_COOLDOWN =
  60 * 1000;

const TEMPORARY_ERROR_COOLDOWN =
  15 * 1000;

const INVALID_MODEL_COOLDOWN =
  60 * 60 * 1000;

const AUTH_ERROR_COOLDOWN =
  60 * 60 * 1000;

let lastSuccessfulCandidate =
  null;

/*
|--------------------------------------------------------------------------
| CANDIDATE HELPERS
|--------------------------------------------------------------------------
*/

function candidateKey(
  provider,
  model
) {
  return `${provider.id}:${model}`;
}

function isCoolingDown(
  key
) {
  const until =
    cooldownUntil.get(key);

  return Boolean(
    until &&
      Date.now() < until
  );
}

function setCooldown(
  key,
  milliseconds
) {
  cooldownUntil.set(
    key,
    Date.now() +
      milliseconds
  );
}

function clearCooldown(
  key
) {
  cooldownUntil.delete(key);
}

/*
|--------------------------------------------------------------------------
| BUILD MODEL LIST
|--------------------------------------------------------------------------
|
| Manual mode:
| selected provider/model first.
|
| Auto mode:
| last successful model first.
|
|--------------------------------------------------------------------------
*/

function buildCandidates(
  preferredProvider = "auto",
  preferredModel = "auto"
) {
  const all = [];

  for (const provider of
    PROVIDERS) {
    for (const model of
      provider.models) {
      all.push({
        provider,
        model,
        key: candidateKey(
          provider,
          model
        ),
      });
    }
  }

  /*
  MANUAL MODE
  */

  if (
    preferredProvider &&
    preferredProvider !==
      "auto"
  ) {
    const selected =
      all.filter(
        (candidate) =>
          candidate.provider.id ===
            preferredProvider &&
          (
            preferredModel ===
              "auto" ||
            candidate.model ===
              preferredModel
          )
      );

    const rest =
      all.filter(
        (candidate) =>
          !selected.some(
            (item) =>
              item.key ===
              candidate.key
          )
      );

    return [
      ...selected,
      ...rest,
    ];
  }

  /*
  AUTO MODE
  */

  if (
    lastSuccessfulCandidate
  ) {
    const index =
      all.findIndex(
        (candidate) =>
          candidate.key ===
          lastSuccessfulCandidate.key
      );

    if (index >= 0) {
      const [preferred] =
        all.splice(
          index,
          1
        );

      all.unshift(
        preferred
      );
    }
  }

  const healthy =
    all.filter(
      (candidate) =>
        !isCoolingDown(
          candidate.key
        )
    );

  const cooling =
    all.filter(
      (candidate) =>
        isCoolingDown(
          candidate.key
        )
    );

  return [
    ...healthy,
    ...cooling,
  ];
}

/*
|--------------------------------------------------------------------------
| ERROR CLASSIFICATION
|--------------------------------------------------------------------------
*/

function classifyError(
  error
) {
  const status =
    Number(
      error?.status || 0
    );

  const message =
    String(
      error?.message || ""
    ).toLowerCase();

  /*
  429 = rate limit
  */

  if (
    status === 429 ||
    message.includes(
      "rate limit"
    ) ||
    message.includes(
      "quota"
    )
  ) {
    return {
      retry: true,

      cooldown:
        RATE_LIMIT_COOLDOWN,

      reason:
        "rate-limit",
    };
  }

  /*
  Temporary provider failure
  */

  if (
    status === 408 ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return {
      retry: true,

      cooldown:
        TEMPORARY_ERROR_COOLDOWN,

      reason:
        "temporary-provider-error",
    };
  }

  /*
  Timeout
  */

  if (
    message.includes(
      "timeout"
    ) ||
    message.includes(
      "timed out"
    ) ||
    message.includes(
      "fetch failed"
    )
  ) {
    return {
      retry: true,

      cooldown:
        TEMPORARY_ERROR_COOLDOWN,

      reason: "timeout",
    };
  }

  /*
  Invalid/removed model
  */

  if (
    status === 404 ||
    message.includes(
      "model not found"
    ) ||
    message.includes(
      "model does not exist"
    ) ||
    message.includes(
      "unknown model"
    ) ||
    message.includes(
      "no longer available"
    )
  ) {
    return {
      retry: true,

      cooldown:
        INVALID_MODEL_COOLDOWN,

      reason:
        "model-unavailable",
    };
  }

  /*
  Authentication
  */

  if (
    status === 401 ||
    status === 403
  ) {
    return {
      retry: true,

      cooldown:
        AUTH_ERROR_COOLDOWN,

      reason:
        "authentication",
    };
  }

  /*
  Unknown failure.
  One fallback is still allowed.
  */

  return {
    retry: true,

    cooldown:
      TEMPORARY_ERROR_COOLDOWN,

    reason:
      "unknown-provider-error",
  };
}

/*
|--------------------------------------------------------------------------
| OPENAI-COMPATIBLE REQUEST
|--------------------------------------------------------------------------
*/

async function callOpenAICompatible(
  provider,
  model,
  messages
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(() => {
      controller.abort();
    }, 25000);

  try {
    const response =
      await fetch(
        provider.baseUrl,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization:
              `Bearer ${
                process.env[
                  provider.envKey
                ]
              }`,

            ...(
              provider.extraHeaders ||
              {}
            ),
          },

          body: JSON.stringify({
            model,

            messages,

            tools: TOOLS,

            tool_choice: "auto",

            temperature: 0.7,

            max_tokens: 900,
          }),

          signal:
            controller.signal,
        }
      );

    if (!response.ok) {
      const raw =
        await response.text();

      let parsed = {};

      try {
        parsed =
          JSON.parse(raw);
      } catch {}

      const error =
        new Error(
          parsed?.error
            ?.message ||
            `${provider.id} returned HTTP ${response.status}`
        );

      error.status =
        response.status;

      throw error;
    }

    const data =
      await response.json();

    const choice =
      data?.choices?.[0];

    if (!choice?.message) {
      const error =
        new Error(
          `${provider.id} returned an invalid response.`
        );

      error.status = 502;

      throw error;
    }

    return {
      content:
        choice.message
          .content || "",

      tool_calls:
        choice.message
          .tool_calls || [],
    };
  } catch (error) {
    if (
      error.name ===
      "AbortError"
    ) {
      const timeoutError =
        new Error(
          `${provider.id} request timed out.`
        );

      timeoutError.status =
        504;

      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/*
|--------------------------------------------------------------------------
| GEMINI SCHEMA
|--------------------------------------------------------------------------
*/

function toGeminiSchema(
  schema
) {
  if (
    !schema ||
    typeof schema !==
      "object"
  ) {
    return schema;
  }

  const result = {
    ...schema,
  };

  if (
    typeof result.type ===
    "string"
  ) {
    result.type =
      result.type.toUpperCase();
  }

  if (result.properties) {
    result.properties =
      Object.fromEntries(
        Object.entries(
          result.properties
        ).map(
          ([key, value]) => [
            key,
            toGeminiSchema(
              value
            ),
          ]
        )
      );
  }

  return result;
}

/*
|--------------------------------------------------------------------------
| GEMINI FUNCTIONS
|--------------------------------------------------------------------------
*/

function geminiFunctionDeclarations() {
  return TOOLS.map(
    (tool) => ({
      name:
        tool.function.name,

      description:
        tool.function
          .description,

      parameters:
        toGeminiSchema(
          tool.function
            .parameters
        ),
    })
  );
}

/*
|--------------------------------------------------------------------------
| GEMINI MESSAGE CONVERSION
|--------------------------------------------------------------------------
*/

function toGeminiMessages(
  messages
) {
  const result = [];

  for (const message of
    messages) {
    /*
    System messages are handled
    separately.
    */

    if (
      message.role ===
      "system"
    ) {
      continue;
    }

    /*
    User
    */

    if (
      message.role ===
      "user"
    ) {
      result.push({
        role: "user",

        parts: [
          {
            text:
              message.content ||
              "",
          },
        ],
      });

      continue;
    }

    /*
    Assistant
    */

    if (
      message.role ===
      "assistant"
    ) {
      const parts = [];

      if (
        message.content
      ) {
        parts.push({
          text:
            message.content,
        });
      }

      for (
        const call of
          message.tool_calls ||
          []
      ) {
        let args = {};

        try {
          args =
            JSON.parse(
              call.function
                .arguments ||
                "{}"
            );
        } catch {}

        parts.push({
          functionCall: {
            id: call.id,

            name:
              call.function
                .name,

            args,
          },
        });
      }

      if (parts.length) {
        result.push({
          role: "model",

          parts,
        });
      }

      continue;
    }

    /*
    Tool result
    */

    if (
      message.role ===
      "tool"
    ) {
      let response = {};

      try {
        response =
          JSON.parse(
            message.content ||
              "{}"
          );
      } catch {
        response = {
          result:
            message.content ||
            "",
        };
      }

      result.push({
        role: "user",

        parts: [
          {
            functionResponse: {
              id:
                message.tool_call_id,

              name:
                message.name ||
                "unknown_tool",

              response,
            },
          },
        ],
      });
    }
  }

  return result;
}

/*
|--------------------------------------------------------------------------
| GEMINI REQUEST
|--------------------------------------------------------------------------
*/

async function callGemini(
  provider,
  model,
  messages
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(() => {
      controller.abort();
    }, 25000);

  try {
    const systemMessage =
      messages.find(
        (message) =>
          message.role ===
          "system"
      );

    const response =
      await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          model
        )}:generateContent`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "x-goog-api-key":
              process.env[
                provider.envKey
              ],
          },

          body: JSON.stringify({
            ...(systemMessage
              ? {
                  system_instruction: {
                    parts: [
                      {
                        text:
                          systemMessage.content,
                      },
                    ],
                  },
                }
              : {}),

            contents:
              toGeminiMessages(
                messages
              ),

            tools: [
              {
                functionDeclarations:
                  geminiFunctionDeclarations(),
              },
            ],

            /*
            Gemini 3.x:
            don't send deprecated
            sampling parameters.
            */

            generationConfig: {
              maxOutputTokens: 900,
            },
          }),

          signal:
            controller.signal,
        }
      );

    if (!response.ok) {
      const raw =
        await response.text();

      let parsed = {};

      try {
        parsed =
          JSON.parse(raw);
      } catch {}

      const error =
        new Error(
          parsed?.error
            ?.message ||
            `Gemini HTTP ${response.status}`
        );

      error.status =
        response.status;

      throw error;
    }

    const data =
      await response.json();

    const candidate =
      data?.candidates?.[0];

    if (!candidate) {
      const error =
        new Error(
          "Gemini returned no candidate."
        );

      error.status = 502;

      throw error;
    }

    const parts =
      candidate.content?.parts ||
      [];

    const content =
      parts
        .filter(
          (part) =>
            part.text
        )
        .map(
          (part) =>
            part.text
        )
        .join("")
        .trim();

    const toolCalls =
      parts
        .filter(
          (part) =>
            part.functionCall
        )
        .map(
          (
            part,
            index
          ) => ({
            id:
              part.functionCall
                .id ||
              `gemini_${Date.now()}_${index}`,

            type:
              "function",

            function: {
              name:
                part.functionCall
                  .name,

              arguments:
                JSON.stringify(
                  part.functionCall
                    .args || {}
                ),
            },
          })
        );

    return {
      content,

      tool_calls:
        toolCalls,
    };
  } catch (error) {
    if (
      error.name ===
      "AbortError"
    ) {
      const timeoutError =
        new Error(
          "Gemini request timed out."
        );

      timeoutError.status =
        504;

      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/*
|--------------------------------------------------------------------------
| GENERIC MODEL CALL
|--------------------------------------------------------------------------
*/

async function callModel(
  candidate,
  messages
) {
  if (
    candidate.provider.kind ===
    "gemini"
  ) {
    return callGemini(
      candidate.provider,
      candidate.model,
      messages
    );
  }

  return callOpenAICompatible(
    candidate.provider,
    candidate.model,
    messages
  );
}

/*
|--------------------------------------------------------------------------
| AI ROUTER
|--------------------------------------------------------------------------
|
| VERY IMPORTANT:
|
| First request:
|     one model only.
|
| If success:
|     STOP.
|
| If retryable failure:
|     next model.
|
| Never broadcast one request to all
| models simultaneously.
|
|--------------------------------------------------------------------------
*/

async function callAI(
  messages,
  preferredProvider = "auto",
  preferredModel = "auto"
) {
  const candidates =
    buildCandidates(
      preferredProvider,
      preferredModel
    );

  if (
    candidates.length ===
    0
  ) {
    const error =
      new Error(
        "No AI provider/model is configured on the server."
      );

    error.status = 500;

    throw error;
  }

  let lastError = null;

  const maxAttempts =
    Math.min(
      candidates.length,

      Number(
        process.env.MAX_AI_ATTEMPTS ||
          3
      )
    );

  const startingCandidate =
    candidates[0];

  for (
    let attempt = 0;
    attempt <
    maxAttempts;
    attempt++
  ) {
    const candidate =
      candidates[attempt];

    /*
    Skip cooling model when a healthy
    candidate exists.
    */

    if (
      isCoolingDown(
        candidate.key
      ) &&
      candidates.some(
        (item) =>
          !isCoolingDown(
            item.key
          )
      )
    ) {
      continue;
    }

    try {
      console.log(
        `[AI] Attempt ${
          attempt + 1
        }/${maxAttempts}: ${
          candidate.provider.id
        }/${candidate.model}`
      );

      const message =
        await callModel(
          candidate,
          messages
        );

      /*
      SUCCESS:
      do NOT call any more models.
      */

      lastSuccessfulCandidate =
        candidate;

      clearCooldown(
        candidate.key
      );

      console.log(
        `[AI] Success: ${candidate.provider.id}/${candidate.model}`
      );

      return {
        message,

        providerId:
          candidate.provider
            .id,

        model:
          candidate.model,

        switched:
          attempt > 0 ||
          startingCandidate.key !==
            candidate.key,
      };
    } catch (error) {
      lastError =
        error;

      const classification =
        classifyError(
          error
        );

      setCooldown(
        candidate.key,
        classification.cooldown
      );

      console.error(
        `[AI] Failed ${candidate.provider.id}/${candidate.model}: ${error.message}`
      );

      console.error(
        `[AI] Reason: ${classification.reason}`
      );

      /*
      Next model ONLY because this
      model failed.
      */
    }
  }

  const error =
    new Error(
      lastError?.message ||
        "All available AI models failed."
    );

  error.status =
    lastError?.status ||
    502;

  throw error;
}

/*
|--------------------------------------------------------------------------
| SYSTEM PROMPT
|--------------------------------------------------------------------------
*/

function buildSystemPrompt(
  memoryFacts
) {
  const memoryText =
    memoryFacts.length > 0
      ? `

Known user memories:
${memoryFacts
  .map(
    (fact) =>
      `- ${fact.fact}`
  )
  .join("\n")}`
      : "";

  return `
You are Aria, a helpful AI voice companion.

Be natural, friendly, accurate and concise.

Rules:

- Answer the user's actual question directly.
- Do not mention internal routing unless necessary.
- Do not invent tool results.
- Use tools only when genuinely needed.
- Do not call tools unnecessarily.
- Normal conversation should be answered normally.
- If the user explicitly asks for a reminder, use set_reminder.
- If the user explicitly asks to save a note, use save_note.
- If the user explicitly asks you to remember something, use remember_fact.
- Use get_weather for current weather.
- Use calculate for calculations.
- Use open_app_or_url only when the user explicitly asks to open something.
- Use search_web only when external/current information is actually required.
- After a successful tool, give a natural confirmation.
- Never claim an action happened if it did not happen.
- Keep normal responses concise unless the user asks for detail.
- Structure explanations so they sound natural when read aloud.

${memoryText}
`;
}

/*
|--------------------------------------------------------------------------
| CONVERSATION
|--------------------------------------------------------------------------
*/

async function loadConversation() {
  if (!mongoReady) {
    return [];
  }

  try {
    const document =
      await Conversation.findOne()
        .lean();

    return (
      document?.messages ||
      []
    );
  } catch (error) {
    console.error(
      "loadConversation:",
      error.message
    );

    return [];
  }
}

async function saveConversation(
  messages
) {
  if (!mongoReady) {
    return;
  }

  try {
    await Conversation.findOneAndUpdate(
      {},

      {
        messages,

        updatedAt:
          new Date(),
      },

      {
        upsert: true,

        new: true,

        setDefaultsOnInsert:
          true,
      }
    );
  } catch (error) {
    console.error(
      "saveConversation:",
      error.message
    );
  }
}

/*
|--------------------------------------------------------------------------
| HEALTH
|--------------------------------------------------------------------------
*/

function healthPayload() {
  return {
    ok: true,

    service:
      "aria-api",

    database:
      mongoReady
        ? "connected"
        : "disconnected",

    configuredProviders:
      PROVIDERS.map(
        (provider) => ({
          id:
            provider.id,

          name:
            provider.id,

          models:
            provider.models,
        })
      ),

    lastUsed:
      lastSuccessfulCandidate
        ? `${lastSuccessfulCandidate.provider.id}/${lastSuccessfulCandidate.model}`
        : null,

    maxAIAttempts:
      Number(
        process.env.MAX_AI_ATTEMPTS ||
          3
      ),

    timestamp:
      new Date().toISOString(),
  };
}

app.get(
  "/health",
  (req, res) => {
    res.json(
      healthPayload()
    );
  }
);

/*
Mobile/client compatibility.
*/

app.get(
  "/api/health",
  (req, res) => {
    res.json(
      healthPayload()
    );
  }
);

/*
|--------------------------------------------------------------------------
| CONVERSATION
|--------------------------------------------------------------------------
*/

app.get(
  "/api/conversation",
  async (req, res) => {
    try {
      const messages =
        await loadConversation();

      res.json({
        messages,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          "Unable to load conversation.",
      });
    }
  }
);

app.post(
  "/api/conversation/clear",
  async (req, res) => {
    try {
      if (mongoReady) {
        await Conversation.findOneAndUpdate(
          {},

          {
            messages: [],

            updatedAt:
              new Date(),
          },

          {
            upsert: true,
          }
        );
      }

      res.json({
        ok: true,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          "Unable to clear conversation.",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| REMINDERS
|--------------------------------------------------------------------------
*/

app.get(
  "/api/reminders",
  async (req, res) => {
    try {
      if (!mongoReady) {
        return res.json({
          reminders: [],
        });
      }

      const reminders =
        await Reminder.find({
          delivered: false,
        })
          .sort({
            dueAt: 1,
          })
          .lean();

      res.json({
        reminders,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          "Unable to load reminders.",
      });
    }
  }
);

app.get(
  "/api/reminders/due",
  async (req, res) => {
    try {
      if (!mongoReady) {
        return res.json({
          due: [],
        });
      }

      const due =
        await Reminder.find({
          delivered: false,

          dueAt: {
            $lte: new Date(),
          },
        }).lean();

      if (due.length > 0) {
        await Reminder.updateMany(
          {
            _id: {
              $in: due.map(
                (item) =>
                  item._id
              ),
            },
          },

          {
            $set: {
              delivered: true,
            },
          }
        );
      }

      res.json({
        due,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          "Unable to check reminders.",
      });
    }
  }
);

app.delete(
  "/api/reminders/:id",
  async (req, res) => {
    try {
      if (mongoReady) {
        await Reminder.findByIdAndDelete(
          req.params.id
        );
      }

      const reminders =
        mongoReady
          ? await Reminder.find({
              delivered:
                false,
            })
              .sort({
                dueAt: 1,
              })
              .lean()
          : [];

      res.json({
        reminders,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          "Unable to delete reminder.",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| NOTES
|--------------------------------------------------------------------------
*/

app.get(
  "/api/notes",
  async (req, res) => {
    try {
      if (!mongoReady) {
        return res.json({
          notes: [],
        });
      }

      const notes =
        await Note.find()
          .sort({
            createdAt: -1,
          })
          .lean();

      res.json({
        notes,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          "Unable to load notes.",
      });
    }
  }
);

app.delete(
  "/api/notes/:id",
  async (req, res) => {
    try {
      if (mongoReady) {
        await Note.findByIdAndDelete(
          req.params.id
        );
      }

      const notes =
        mongoReady
          ? await Note.find()
              .sort({
                createdAt: -1,
              })
              .lean()
          : [];

      res.json({
        notes,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          "Unable to delete note.",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| MEMORY
|--------------------------------------------------------------------------
*/

app.get(
  "/api/memory",
  async (req, res) => {
    try {
      if (!mongoReady) {
        return res.json({
          facts: [],
        });
      }

      const facts =
        await Memory.find()
          .sort({
            createdAt: -1,
          })
          .lean();

      res.json({
        facts,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          "Unable to load memory.",
      });
    }
  }
);

app.delete(
  "/api/memory/:id",
  async (req, res) => {
    try {
      if (mongoReady) {
        await Memory.findByIdAndDelete(
          req.params.id
        );
      }

      const facts =
        mongoReady
          ? await Memory.find()
              .sort({
                createdAt: -1,
              })
              .lean()
          : [];

      res.json({
        facts,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          "Unable to delete memory.",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| CHAT
|--------------------------------------------------------------------------
*/

app.post(
  "/api/chat",
  async (req, res) => {
    const startedAt =
      Date.now();

    try {
      const userMessage =
        typeof req.body
          ?.message ===
        "string"
          ? req.body.message.trim()
          : "";

      const preferredProvider =
        typeof req.body
          ?.preferredProvider ===
        "string"
          ? req.body
              .preferredProvider
          : "auto";

      const preferredModel =
        typeof req.body
          ?.preferredModel ===
        "string"
          ? req.body
              .preferredModel
          : "auto";

      if (!userMessage) {
        return res.status(400).json({
          error:
            "message is required.",
        });
      }

      if (
        userMessage.length >
        12000
      ) {
        return res.status(400).json({
          error:
            "Message is too long.",
        });
      }

      if (
        PROVIDERS.length ===
        0
      ) {
        return res.status(503).json({
          error:
            "No AI provider is configured. Add at least one AI API key to Render.",
        });
      }

      /*
      Load shared memory.

      EVERY model receives the same memory.
      */

      const memoryFacts =
        mongoReady
          ? await Memory.find()
              .sort({
                createdAt: -1,
              })
              .limit(30)
              .lean()
          : [];

      /*
      Load conversation.
      */

      const history =
        await loadConversation();

      const trimmedHistory =
        history.slice(
          -HISTORY_WINDOW
        );

      /*
      Initial model messages.
      */

      let messages = [
        {
          role: "system",

          content:
            buildSystemPrompt(
              memoryFacts
            ),
        },

        ...trimmedHistory,

        {
          role: "user",

          content:
            userMessage,
        },
      ];

      const actions = [];

      let finalText = "";

      let providerId = null;

      let model = null;

      let switched = false;

      /*
      Tool loop.

      A model gets the request.

      If it requests a tool:
        execute tool
        return result to model

      If model fails:
        callAI() performs fallback.

      We never send the original request
      to every model at the same time.
      */

      for (
        let iteration = 0;
        iteration <
        MAX_TOOL_ITERATIONS;
        iteration++
      ) {
        const result =
          await callAI(
            messages,
            preferredProvider,
            preferredModel
          );

        providerId =
          result.providerId;

        model =
          result.model;

        switched =
          result.switched;

        const assistantMessage =
          result.message;

        const toolCalls =
          assistantMessage.tool_calls ||
          [];

        /*
        Normal response.
        */

        if (
          toolCalls.length ===
          0
        ) {
          finalText =
            String(
              assistantMessage.content ||
                ""
            ).trim();

          break;
        }

        /*
        Add assistant tool call.
        */

        messages.push({
          role: "assistant",

          content:
            assistantMessage.content ||
            null,

          tool_calls:
            toolCalls,
        });

        /*
        Execute tools.
        */

        for (const toolCall of
          toolCalls) {
          const toolName =
            toolCall?.function
              ?.name;

          let args = {};

          try {
            args =
              JSON.parse(
                toolCall?.function
                  ?.arguments ||
                  "{}"
              );
          } catch {
            args = {};
          }

          console.log(
            `[TOOL] ${toolName}`,
            args
          );

          const toolResult =
            await runTool(
              toolName,
              args
            );

          /*
          Persist reminder/note/memory.
          */

          if (
            mongoReady &&
            toolResult.persistence
          ) {
            const persistence =
              toolResult.persistence;

            try {
              if (
                persistence.type ===
                "reminder"
              ) {
                await Reminder.create(
                  {
                    text:
                      persistence.text,

                    dueAt:
                      persistence.dueAt,

                    delivered:
                      false,
                  }
                );
              }

              if (
                persistence.type ===
                "note"
              ) {
                await Note.create(
                  {
                    text:
                      persistence.text,
                  }
                );
              }

              if (
                persistence.type ===
                "memory"
              ) {
                await Memory.create(
                  {
                    fact:
                      persistence.fact,
                  }
                );
              }
            } catch (
              databaseError
            ) {
              console.error(
                "Tool persistence error:",
                databaseError.message
              );
            }
          }

          /*
          Browser action.
          */

          if (
            toolResult.action
          ) {
            actions.push(
              toolResult.action
            );
          }

          /*
          Tool result sent to model.
          */

          messages.push({
            role: "tool",

            tool_call_id:
              toolCall.id,

            name:
              toolName,

            content:
              JSON.stringify(
                toolResult.functionResponse ||
                  {}
              ),
          });
        }
      }

      if (!finalText) {
        finalText =
          "I completed the request, but I couldn't generate the final response.";
      }

      /*
      Save conversation.
      */

      const newHistory = [
        ...history,

        {
          role: "user",

          content:
            userMessage,
        },

        {
          role: "assistant",

          content:
            finalText,
        },
      ].slice(
        -HISTORY_WINDOW
      );

      await saveConversation(
        newHistory
      );

      const elapsedMs =
        Date.now() -
        startedAt;

      console.log(
        `[CHAT] ${providerId}/${model} completed in ${elapsedMs}ms`
      );

      res.json({
        ok: true,

        reply:
          finalText,

        actions,

        provider:
          providerId,

        model,

        switched,

        database:
          mongoReady
            ? "connected"
            : "unavailable",

        elapsedMs,
      });
    } catch (error) {
      console.error(
        "[CHAT ERROR]",
        error
      );

      const status =
        Number(
          error.status
        ) >= 400 &&
        Number(
          error.status
        ) < 600
          ? Number(
              error.status
            )
          : 500;

      res.status(status).json({
        ok: false,

        error:
          error.message ||
          "Aria failed to process the request.",

        elapsedMs:
          Date.now() -
          startedAt,
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| 404
|--------------------------------------------------------------------------
*/

app.use(
  (req, res) => {
    res.status(404).json({
      ok: false,

      error:
        `Route not found: ${req.method} ${req.path}`,
    });
  }
);

/*
|--------------------------------------------------------------------------
| GLOBAL ERROR
|--------------------------------------------------------------------------
*/

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "Unhandled Express error:",
      error
    );

    if (
      res.headersSent
    ) {
      return next(
        error
      );
    }

    res.status(500).json({
      ok: false,

      error:
        "Internal server error.",
    });
  }
);

/*
|--------------------------------------------------------------------------
| START
|--------------------------------------------------------------------------
*/

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Aria API listening on 0.0.0.0:${PORT}`
    );

    console.log(
      `Configured AI providers: ${
        PROVIDERS.length > 0
          ? PROVIDERS.map(
              (provider) =>
                `${provider.id}[${provider.models.join(
                  ", "
                )}]`
            ).join(" | ")
          : "NONE"
      }`
    );
  }
);