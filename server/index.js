import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
// Optional: constrain reasoning effort on reasoning models (none|low|medium|high).
const REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || "low";

app.post("/api/chat", async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({
      error: "OPENAI_API_KEY is not set. Copy .env.example to .env and add your key."
    });
  }

  const { prompt, maxTokens } = req.body || {};
  if (!prompt) {
    return res.status(400).json({ error: "Missing 'prompt' in request body." });
  }

  try {
    // Reasoning models spend tokens on hidden reasoning that also counts against
    // max_completion_tokens, so add headroom to avoid truncating the visible answer.
    const outputBudget = (maxTokens || 1024) + 4096;

    const body = {
      model: MODEL,
      max_completion_tokens: outputBudget,
      messages: [{ role: "user", content: prompt }]
    };
    if (REASONING_EFFORT) body.reasoning_effort = REASONING_EFFORT;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || "OpenAI API error" });
    }

    const text = (data.choices || []).map((c) => c.message?.content || "").join("\n");
    res.json({ text });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unexpected server error" });
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`ChatGPT proxy running on http://localhost:${PORT}`);
  console.log(`Using model: ${MODEL}`);
});
