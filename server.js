const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => res.send("FinanceAI Proxy Running ✓"));

// AI Chat
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

// Create Razorpay Subscription
app.post("/api/create-subscription", async (req, res) => {
  try {
    const KEY_ID     = process.env.RAZORPAY_KEY_ID;
    const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
    const PLAN_ID    = process.env.RAZORPAY_PLAN_ID;

    if (!KEY_ID || !KEY_SECRET || !PLAN_ID) {
      return res.status(500).json({ error: "Razorpay keys not set in environment" });
    }

    const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");

    const response = await fetch("https://api.razorpay.com/v1/subscriptions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${auth}`,
      },
      body: JSON.stringify({
        plan_id: PLAN_ID,
        total_count: 12,
        quantity: 1,
        customer_notify: 1,
        notes: { app: "FinanceAI India" },
      }),
    });

    const data = await response.json();
    if (data.error) return res.status(400).json({ error: data.error.description });

    res.json({ subscriptionId: data.id, keyId: KEY_ID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify Payment Signature
app.post("/api/verify-payment", (req, res) => {
  try {
    const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body;
    const payload  = `${razorpay_payment_id}|${razorpay_subscription_id}`;
    const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(payload).digest("hex");
    if (expected === razorpay_signature) {
      res.json({ verified: true });
    } else {
      res.status(400).json({ verified: false });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3000, () => console.log("FinanceAI Proxy running"));
