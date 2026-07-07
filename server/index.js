import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

app.post("/api/claude", async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({
      error: "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key."
    });
  }

  const { prompt, maxTokens } = req.body || {};
  if (!prompt) {
    return res.status(400).json({ error: "Missing 'prompt' in request body." });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens || 1024,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || "Anthropic API error" });
    }

    const text = (data.content || []).map((b) => b.text || "").join("\n");
    res.json({ text });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unexpected server error" });
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`Claude proxy running on http://localhost:${PORT}`);
  console.log(`Using model: ${MODEL}`);
});
