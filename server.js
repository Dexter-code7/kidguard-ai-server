require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const admin = require("firebase-admin"); // Make sure you run: npm install firebase-admin

const app = express();
const PORT = process.env.PORT || 3000;

// --- GEMINI SETUP (Your code – perfect!) ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("ERROR: GEMINI_API_KEY missing!");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
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

// --- FIREBASE ADMIN SETUP (SECURE FOR RENDER) ---
let db = null;

try {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (serviceAccountJson) {
    const serviceAccount = JSON.parse(serviceAccountJson);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    db = admin.firestore();
    console.log("Firebase Admin connected – logging enabled!");
  } else {
    console.warn("FIREBASE_SERVICE_ACCOUNT not set – running without logging");
  }
} catch (error) {
  console.error("Firebase Admin init failed:", error.message);
}

// --- LOG TO FIRESTORE ---
async function logToFirebase(deviceId, query, action) {
  if (!db) return; // No logging if Firebase not connected

  if (
    !deviceId ||
    deviceId === "unknown" ||
    deviceId === "browser-extension-v1"
  ) {
    return;
  }

  try {
    await db.collection("search_logs").add({
      deviceId: deviceId.trim(),
      query: query.trim(),
      action: action,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[Logged] ${deviceId} → "${query}" → ${action}`);
  } catch (error) {
    console.error("[Log Error]", error.message);
  }
}

// --- AI MODERATION (Your code – unchanged and great) ---
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
    return "block";
  }
}

// --- MAIN ENDPOINT ---
app.post("/moderate", async (req, res) => {
  const { query, deviceId = "unknown" } = req.body;

  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "Valid 'query' required" });
  }

  console.log(`[Processing] Device: ${deviceId} | Query: "${query}"`);

  const action = await moderateWithAI(query);

  console.log(`[Verdict] "${query}" → ${action.toUpperCase()}`);

  // 🔥 Save to Firebase (fire & forget)
  logToFirebase(deviceId, query, action);

  res.json({ action });
});

// Health & root
app.get("/health", (req, res) => res.status(200).send("OK"));
app.get("/", (req, res) => res.send("KidGuard AI Server running!"));

app.listen(PORT, () => {
  console.log(`KidGuard AI Server running on port ${PORT}`);
});
