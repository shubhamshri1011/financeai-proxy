const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ─── In-memory room storage (persists while server runs) ─────────────────────
const rooms = {};

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.send("FinanceAI Proxy Running ✓"));

// ─── AI Chat ─────────────────────────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Razorpay: Create Subscription ───────────────────────────────────────────
app.post("/api/create-subscription", async (req, res) => {
  try {
    const KEY_ID = process.env.RAZORPAY_KEY_ID;
    const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
    const PLAN_ID = process.env.RAZORPAY_PLAN_ID;
    if (!KEY_ID || !KEY_SECRET || !PLAN_ID) return res.status(500).json({ error: "Razorpay keys not configured" });
    const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
    const response = await fetch("https://api.razorpay.com/v1/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Basic ${auth}` },
      body: JSON.stringify({ plan_id: PLAN_ID, total_count: 12, quantity: 1, customer_notify: 1 }),
    });
    const data = await response.json();
    if (data.error) return res.status(400).json({ error: data.error.description });
    res.json({ subscriptionId: data.id, keyId: KEY_ID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Razorpay: Verify Payment ─────────────────────────────────────────────────
app.post("/api/verify-payment", (req, res) => {
  try {
    const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body;
    const payload = `${razorpay_payment_id}|${razorpay_subscription_id}`;
    const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(payload).digest("hex");
    res.json({ verified: expected === razorpay_signature });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GROUP ROOMS API ──────────────────────────────────────────────────────────

function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function sanitize(s) {
  return String(s || "").replace(/[<>"'`]/g, "").trim().slice(0, 100);
}

// Create room
app.post("/api/room/create", (req, res) => {
  try {
    const { name, createdBy } = req.body;
    if (!name || !createdBy) return res.status(400).json({ error: "Name and createdBy required" });
    let code = genCode();
    while (rooms[code]) code = genCode(); // ensure unique
    const room = {
      code,
      name: sanitize(name),
      createdBy: sanitize(createdBy),
      members: [sanitize(createdBy)],
      expenses: [],
      createdAt: new Date().toISOString(),
    };
    rooms[code] = room;
    console.log(`Room created: ${code} by ${createdBy}`);
    res.json({ room });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get room
app.get("/api/room/:code", (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = rooms[code];
  if (!room) return res.status(404).json({ error: "Room not found! Code check karo." });
  res.json(room);
});

// Join room
app.post("/api/room/:code/join", (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = rooms[code];
  if (!room) return res.status(404).json({ error: "Room not found! Code check karo." });
  const name = sanitize(req.body.name);
  if (!name) return res.status(400).json({ error: "Name required" });
  if (!room.members.includes(name)) room.members.push(name);
  res.json(room);
});

// Add expense to room
app.post("/api/room/:code/expense", (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = rooms[code];
  if (!room) return res.status(404).json({ error: "Room not found!" });
  const { amount, what, paidBy, date } = req.body;
  if (!amount || !what || !paidBy) return res.status(400).json({ error: "amount, what, paidBy required" });
  const expense = {
    id: Date.now(),
    amount: parseFloat(amount),
    what: sanitize(what),
    paidBy: sanitize(paidBy),
    date: date || new Date().toISOString().slice(0, 10),
    addedAt: new Date().toISOString(),
  };
  room.expenses.unshift(expense);
  res.json({ room });
});

// Delete room expense
app.delete("/api/room/:code/expense/:id", (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = rooms[code];
  if (!room) return res.status(404).json({ error: "Room not found!" });
  room.expenses = room.expenses.filter(e => e.id !== parseInt(req.params.id));
  res.json({ room });
});

// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FinanceAI Proxy running on port ${PORT}`));
