/*
|--------------------------------------------------------------------------
| ARIA TOOLS
|--------------------------------------------------------------------------
|
| Tools are executed ONLY when the AI explicitly requests them.
|
| Simple deterministic operations are handled without an LLM whenever
| possible.
|
*/

export const TOOLS = [
  {
    type: "function",

    function: {
      name: "set_reminder",

      description:
        "Create a reminder when the user explicitly asks to be reminded later.",

      parameters: {
        type: "object",

        properties: {
          text: {
            type: "string",

            description:
              "What the user should be reminded about.",
          },

          delayMinutes: {
            type: "number",

            description:
              "Number of minutes from now until the reminder is due.",
          },
        },

        required: [
          "text",
          "delayMinutes",
        ],
      },
    },
  },

  {
    type: "function",

    function: {
      name: "save_note",

      description:
        "Save a note when the user explicitly asks Aria to save or take a note.",

      parameters: {
        type: "object",

        properties: {
          text: {
            type: "string",

            description:
              "The note text.",
          },
        },

        required: ["text"],
      },
    },
  },

  {
    type: "function",

    function: {
      name: "remember_fact",

      description:
        "Remember a long-term fact when the user explicitly asks Aria to remember it.",

      parameters: {
        type: "object",

        properties: {
          fact: {
            type: "string",

            description:
              "The fact to remember.",
          },
        },

        required: ["fact"],
      },
    },
  },

  {
    type: "function",

    function: {
      name: "get_weather",

      description:
        "Get current weather information for a requested location.",

      parameters: {
        type: "object",

        properties: {
          location: {
            type: "string",

            description:
              "City or location.",
          },
        },

        required: ["location"],
      },
    },
  },

  {
    type: "function",

    function: {
      name: "calculate",

      description:
        "Calculate a mathematical expression.",

      parameters: {
        type: "object",

        properties: {
          expression: {
            type: "string",

            description:
              "Mathematical expression.",
          },
        },

        required: ["expression"],
      },
    },
  },

  {
    type: "function",

    function: {
      name: "open_app_or_url",

      description:
        "Open a website or URL when the user explicitly asks to open it.",

      parameters: {
        type: "object",

        properties: {
          target: {
            type: "string",

            description:
              "Website or URL to open.",
          },
        },

        required: ["target"],
      },
    },
  },

  {
    type: "function",

    function: {
      name: "search_web",

      description:
        "Search the web when current or external information is required.",

      parameters: {
        type: "object",

        properties: {
          query: {
            type: "string",

            description:
              "Search query.",
          },
        },

        required: ["query"],
      },
    },
  },
];

/*
|--------------------------------------------------------------------------
| SAFE NUMBER
|--------------------------------------------------------------------------
*/

function safeNumber(
  value,
  fallback = 0
) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return number;
}

/*
|--------------------------------------------------------------------------
| CALCULATOR
|--------------------------------------------------------------------------
*/

function calculateExpression(
  expression
) {
  if (
    typeof expression !==
    "string"
  ) {
    throw new Error(
      "Expression must be a string."
    );
  }

  const cleaned =
    expression
      .replace(/,/g, "")
      .replace(/%/g, "/100")
      .trim();

  /*
  Only mathematical characters are allowed.
  */

  if (
    !/^[0-9+\-*/().\s]+$/.test(
      cleaned
    )
  ) {
    throw new Error(
      "Invalid mathematical expression."
    );
  }

  if (cleaned.length > 200) {
    throw new Error(
      "Expression is too long."
    );
  }

  const result =
    Function(
      `"use strict"; return (${cleaned})`
    )();

  if (
    !Number.isFinite(result)
  ) {
    throw new Error(
      "Calculation did not produce a finite number."
    );
  }

  return result;
}

/*
|--------------------------------------------------------------------------
| WEATHER
|--------------------------------------------------------------------------
*/

async function getWeather(
  location
) {
  const city = String(
    location || ""
  ).trim();

  if (!city) {
    throw new Error(
      "Weather location is required."
    );
  }

  const url =
    `https://wttr.in/` +
    `${encodeURIComponent(
      city
    )}?format=j1`;

  const response =
    await fetch(url, {
      headers: {
        "User-Agent":
          "Aria-AI-Assistant/1.0",
      },

      signal:
        AbortSignal.timeout(
          8000
        ),
    });

  if (!response.ok) {
    throw new Error(
      `Weather service returned HTTP ${response.status}.`
    );
  }

  const data =
    await response.json();

  const current =
    data?.current_condition?.[0];

  if (!current) {
    throw new Error(
      "Weather information was unavailable."
    );
  }

  return {
    location: city,

    temperatureC:
      current.temp_C,

    feelsLikeC:
      current.FeelsLikeC,

    humidity:
      current.humidity,

    windKmph:
      current.windspeedKmph,

    condition:
      current.weatherDesc?.[0]
        ?.value ||
      "Unknown",
  };
}

/*
|--------------------------------------------------------------------------
| TOOL RUNNER
|--------------------------------------------------------------------------
*/

export async function runTool(
  name,
  args = {}
) {
  switch (name) {
    /*
    Reminder
    */

    case "set_reminder": {
      const text = String(
        args.text || ""
      ).trim();

      const delayMinutes =
        safeNumber(
          args.delayMinutes
        );

      if (!text) {
        return {
          functionResponse: {
            ok: false,

            error:
              "Reminder text is required.",
          },
        };
      }

      if (
        delayMinutes <= 0 ||
        delayMinutes >
          60 * 24 * 365
      ) {
        return {
          functionResponse: {
            ok: false,

            error:
              "Reminder delay is invalid.",
          },
        };
      }

      const dueAt =
        new Date(
          Date.now() +
            delayMinutes *
              60 *
              1000
        );

      return {
        functionResponse: {
          ok: true,

          text,

          delayMinutes,

          dueAt:
            dueAt.toISOString(),
        },

        persistence: {
          type: "reminder",

          text,

          dueAt,
        },
      };
    }

    /*
    Note
    */

    case "save_note": {
      const text = String(
        args.text || ""
      ).trim();

      if (!text) {
        return {
          functionResponse: {
            ok: false,

            error:
              "Note text is required.",
          },
        };
      }

      return {
        functionResponse: {
          ok: true,

          text,
        },

        persistence: {
          type: "note",

          text,
        },
      };
    }

    /*
    Memory
    */

    case "remember_fact": {
      const fact = String(
        args.fact || ""
      ).trim();

      if (!fact) {
        return {
          functionResponse: {
            ok: false,

            error:
              "Memory fact is required.",
          },
        };
      }

      return {
        functionResponse: {
          ok: true,

          fact,
        },

        persistence: {
          type: "memory",

          fact,
        },
      };
    }

    /*
    Calculator
    */

    case "calculate": {
      try {
        const result =
          calculateExpression(
            args.expression
          );

        return {
          functionResponse: {
            ok: true,

            expression:
              args.expression,

            result,
          },
        };
      } catch (error) {
        return {
          functionResponse: {
            ok: false,

            error:
              error.message,
          },
        };
      }
    }

    /*
    Weather
    */

    case "get_weather": {
      try {
        const weather =
          await getWeather(
            args.location
          );

        return {
          functionResponse: {
            ok: true,

            weather,
          },
        };
      } catch (error) {
        return {
          functionResponse: {
            ok: false,

            error:
              error.message,
          },
        };
      }
    }

    /*
    Open URL
    */

    case "open_app_or_url": {
      const target = String(
        args.target || ""
      ).trim();

      if (!target) {
        return {
          functionResponse: {
            ok: false,

            error:
              "Target is required.",
          },
        };
      }

      let url = target;

      if (
        !/^https?:\/\//i.test(
          url
        )
      ) {
        url =
          `https://www.google.com/search?q=` +
          encodeURIComponent(
            target
          );
      }

      return {
        functionResponse: {
          ok: true,

          url,
        },

        action: {
          type: "open_url",

          url,
        },
      };
    }

    /*
    Search web
    */

    case "search_web": {
      const query = String(
        args.query || ""
      ).trim();

      if (!query) {
        return {
          functionResponse: {
            ok: false,

            error:
              "Search query is required.",
          },
        };
      }

      const url =
        `https://www.google.com/search?q=` +
        encodeURIComponent(
          query
        );

      return {
        functionResponse: {
          ok: true,

          query,

          url,
        },

        action: {
          type: "open_url",

          url,
        },
      };
    }

    default:
      return {
        functionResponse: {
          ok: false,

          error:
            `Unknown tool: ${name}`,
        },
      };
  }
}