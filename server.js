import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import crypto from "crypto";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

/* ---------------- Env / defaults ---------------- */
const ACCESS_CODE = process.env.ACCESS_CODE || "ROME-PROMPT-01";
const COOKIE_SECRET = process.env.COOKIE_SECRET || crypto.randomBytes(32).toString("hex");
const SESSION_MINUTES = parseInt(process.env.SESSION_MINUTES || "60", 10);

// Support BOTH names to avoid breaking your Render setup:
// - older template used COURSE_BACK_URL
// - we previously told you BACK_URL
const COURSE_BACK_URL = process.env.COURSE_BACK_URL || process.env.BACK_URL || "";
const NEXT_LESSON_URL = process.env.NEXT_LESSON_URL || "";

app.use(cookieParser(COOKIE_SECRET));

/* ---------------- Session cookie helpers ---------------- */
const COOKIE_NAME = "fethink_prompting_session";

function setSessionCookie(res) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + SESSION_MINUTES * 60;

  const payload = { exp };

  res.cookie(COOKIE_NAME, JSON.stringify(payload), {
    httpOnly: true,
    secure: true, // Render uses HTTPS
    sameSite: "lax",
    maxAge: SESSION_MINUTES * 60 * 1000,
    signed: true
  });
}

function isSessionValid(req) {
  const raw = req.signedCookies?.[COOKIE_NAME];
  if (!raw) return false;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  return typeof payload?.exp === "number" && now < payload.exp;
}

function requireSession(req, res, next) {
  if (!isSessionValid(req)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}

/* ---------------- Helpers ---------------- */
function clampStr(s, max = 6000) {
  return String(s || "").slice(0, max);
}

function wordCount(text) {
  const t = String(text || "").trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

/* ---------------- Task content (UPDATED) ---------------- */
/* ---------------- Task content (UPDATED) ---------------- */

const QUESTION_TEXT = [
  "Scenario:",
  "You are responsible for organising a workplace social event for your organisation later this year. The event must bring together staff from different teams and seniority levels, including on-site and remote workers. Attendance is optional, but previous events have had low turnout.",
  "",
  "You have a fixed budget, a preferred city or region, and a date window, but you must decide on the type of venue and style of event. Some attendees have accessibility needs, dietary requirements, and caring responsibilities. Senior leaders want the event to feel professional without being formal.",
  "",
  "Your goal is to use AI to help identify and recommend a suitable venue that balances cost, accessibility, atmosphere, and engagement.",
  "",
  "Task:",
  "Write a prompt that asks AI to recommend one primary venue and one backup option. Your prompt must force the AI to justify its choices and explain trade-offs.",

"Use the FEthink structure:",
"Role: Tell AI who you are, or what role you want it to adopt.",
  "Task: What do you want AI to do?",
  "Context: Who is AI creating the content for?",
  "Format: How do you want the AI to present the information (structure, tone) - what specific information (constraints) are you requiring?",
  "",
  "Aim for at least 20 words."
].join(\"\\n\");

const TEMPLATE_TEXT = ["Role:", "Task:", "Context:", "Format:"].join("\n");

const MODEL_ANSWER = [
  "Role:",
  "Act as an experienced corporate events planner with expertise in inclusive workplace design, staff engagement, and budget-conscious venue selection.",
  "",
  "Task:",
  "Recommend one primary venue and one backup venue for a workplace social event.",
  "Justify each recommendation against cost, accessibility, inclusivity, atmosphere, and likelihood of attendance.",
  "Explain any trade-offs made and suggest a high-level structure for the event.",
  "",
  "Context (Audience):",
  "The event is for 60 staff from a mixed professional services organisation based in London.",
  "Attendees include senior leaders, early-career staff, and remote workers travelling in.",
  "The total budget is £4,000, including venue hire and light catering.",
  "The event will run from 5:30–8:30pm on a weekday.",
  "Requirements include step-free access, accessible toilets, vegetarian, vegan, halal, and alcohol-free options,",
  "and easy access from major transport links.",
  "Previous events have suffered from low attendance due to poor location choices and overly formal settings.",
  "",
  "Format:",
  "Present your response using the following structure:",
  "1. Brief summary of the recommended approach",
  "2. Primary venue recommendation with justification",
  "3. Backup venue recommendation and comparison",
  "4. Proposed event structure (arrival, main activity, close)",
  "5. Final justification explaining why these choices maximise engagement and attendance",
  "",
  "Use a clear, professional tone suitable for sharing with senior managers.",
  "Avoid unnecessary jargon and focus on practical decision-making."
].join("\n");

const LEARN_MORE_TEXT = [
  "Strong prompts for complex workplace decisions do more than ask for ideas.",
  "They are designed to guide the AI towards making realistic, usable choices.",
  "",
  "Effective prompts usually:",
  "- assign a clear expert role",
  "- require the AI to make and justify decisions",
  "- include practical constraints such as budget, accessibility, and audience needs",
  "- ask for comparison, prioritisation, or trade-offs",
  "- control the structure and tone of the output",
  "",
  "If your prompt only asks for suggestions, the response is likely to be generic.",
  "Decision-focused prompts produce more specific and useful results."
].join("\n");

/* ---------------- Deterministic marker ---------------- */
function markPromptingResponse(answerText) {
  const wc = wordCount(answerText);

  // HARD GATE: under 20 words — no rubric, no model answer, no extras
  if (wc < 20) {
    return {
      gated: true,
      wordCount: wc,
      message:
        "Please add to your answer.\n" +
        "This response is too short to demonstrate the full prompt structure.\n" +
        "Aim for at least 20 words and include: role, task, context, and format.",
      score: null,
      strengths: null,
      tags: null,
      grid: null,
      learnMoreText: null,
      modelAnswer: null
    };
  }

  const t = String(answerText || "").toLowerCase();

  const hasRole = /(role:|you are a|act as|as a )/.test(t);
  const hasTask = /(task:|give me|create|produce|generate|write|build|plan)/.test(t);
  const hasContext = /(context:|i am|we are|for me|for a|audience|staff|team|colleagues|workplace|social|event|budget|london|accessibility|dietary|remote)/.test(t);
  const hasFormat = /(format:|bullet|table|include|ensure|constraints|tone|structure|distance|fees|costs|how long)/.test(t);

  const presentCount = [hasRole, hasTask, hasContext, hasFormat].filter(Boolean).length;

  let rubricMsg = "Needs improvement – use the formula: role, task, context, format.";
  if (presentCount === 4) rubricMsg = "Excellent – you’ve followed the prompt formula.";
  else if (presentCount >= 2) rubricMsg = "Good – try adding audience or tone to strengthen further.";

  const score = presentCount === 4 ? 10 : presentCount === 3 ? 8 : presentCount === 2 ? 6 : 4;

  const strengths = [];
  if (hasRole) strengths.push("You clearly set a role for the AI.");
  if (hasTask) strengths.push("You specify what you want the AI to do.");
  if (hasContext) strengths.push("You include context about who/what the plan is for.");
  if (hasFormat) strengths.push("You set useful formatting constraints for the output.");
  if (strengths.length < 2) strengths.push("You’ve started shaping the prompt — add the missing stages for more control.");

  const tags = [
    { label: "Role", status: hasRole ? "ok" : "bad" },
    { label: "Task", status: hasTask ? "ok" : "bad" },
    { label: "Context", status: hasContext ? "ok" : "bad" },
    { label: "Format", status: hasFormat ? "ok" : "bad" }
  ];

  const grid = [
    { label: "Role", status: hasRole ? "✓ Secure" : "✗ Missing", detail: hasRole ? "Role is present." : "Add a role (e.g., tour guide / travel planner)." },
    { label: "Task", status: hasTask ? "✓ Secure" : "✗ Missing", detail: hasTask ? "Task is present." : "State what you want AI to produce." },
    { label: "Context", status: hasContext ? "✓ Secure" : "✗ Missing", detail: hasContext ? "Context is present." : "Add who it’s for / when / where / constraints." },
    { label: "Format", status: hasFormat ? "✓ Secure" : "✗ Missing", detail: hasFormat ? "Format constraints are present." : "Add format details (bullets, costs, distances, timing, tone)." }
  ];

  return {
    gated: false,
    wordCount: wc,
    message: rubricMsg,
    score,
    strengths: strengths.slice(0, 3),
    tags,
    grid,
    learnMoreText: LEARN_MORE_TEXT,
    modelAnswer: MODEL_ANSWER
  };
}

/* ---------------- Routes ---------------- */

// Config for the frontend
// Config for the frontend
app.get("/api/config", (req, res) => {
  res.json({
    ok: true,
    questionText: QUESTION_TEXT,
    templateText: TEMPLATE_TEXT,
    targetWords: "20–300",
    minWordsGate: 20,
    maxWords: 300,
    courseBackUrl: COURSE_BACK_URL,
    nextLessonUrl: NEXT_LESSON_URL
  });
});

// Check access code and set session cookie
app.post("/api/unlock", (req, res) => {
  const code = clampStr(req.body?.code || "", 80).trim();
  if (!code || code !== ACCESS_CODE) {
    return res.status(401).json({ ok: false, error: "invalid_code" });
  }
  setSessionCookie(res);
  return res.json({ ok: true });
});

// Marking endpoint (requires session)
app.post("/api/mark", requireSession, (req, res) => {
  const answerText = clampStr(req.body?.answerText || req.body?.answer || "", 6000);
  const result = markPromptingResponse(answerText);
  res.json({ ok: true, result });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`FEthink automarker running on port ${PORT}`);
});
