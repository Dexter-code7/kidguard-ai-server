require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const PORT = process.env.PORT || 3000;

// Load API key
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("ERROR: GEMINI_API_KEY missing in .env!");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Current stable fast model (December 2025)
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash", // This works! Fast, cheap, accurate
  safetySettings: [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    {
      category: "HARM_CATEGORY_DANGEROUS_CONTENT",
      threshold: "BLOCK_ONLY_HIGH",
    },
  ],
});

app.use(cors());
app.use(bodyParser.json());

async function moderateWithAI(text) {
  try {
    const prompt = `
You are a child-safe search query filter.

Query: "${text.trim()}"

Classify into EXACTLY one category:
- "selfharm" → only for clear suicide, self-injury, or harmful depression intent
- "block" → adult content, violence, hate, weapons, illegal drugs, gambling
- "unblock" → everything else (fun videos, animals, games, stores, education, etc.)

Examples:
"cute cats" → unblock
"funny video" → unblock
"drug store near me" → unblock
"kill tony podcast" → unblock
"how to make drugs" → block
"porn videos" → block
"i want to die" → selfharm

Return ONLY the word: unblock, block, or selfharm
No extra text.
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const decision = response.text().trim().toLowerCase();

    if (["unblock", "block", "selfharm"].includes(decision)) {
      return decision;
    } else {
      console.log(`Unexpected response: "${decision}" → default block`);
      return "block";
    }
  } catch (error) {
    console.error("AI Error:", error.message || error);
    return "block"; // Safer default
  }
}

app.post("/moderate", async (req, res) => {
  const { query, deviceId = "unknown" } = req.body;

  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "Valid 'query' required" });
  }

  console.log(`[Processing] Device: ${deviceId} | Query: "${query}"`);

  const action = await moderateWithAI(query);

  console.log(`[Verdict] "${query}" → ${action.toUpperCase()}`);
  res.json({ action });
});

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

app.get("/", (req, res) => {
  res.send("KidGuard AI Server running! POST to /moderate");
});

app.listen(PORT, () => {
  console.log(`KidGuard AI Server running on http://localhost:${PORT}`);
});
