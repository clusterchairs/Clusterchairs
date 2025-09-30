require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const bcrypt = require("bcrypt");
const path = require("path");
const Razorpay = require("razorpay");
const crypto = require("crypto");


const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

let db;
(async () => {
  db = await mysql.createPool(dbConfig);
  console.log("✅ Connected to MySQL");
})();

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Register User
app.post("/register", async (req, res) => {
  const { name, mobile, email, password } = req.body;
  if (!name || !mobile || !email || !password) {
    return res.status(400).json({ success: false, message: "All fields required" });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query(
      "INSERT INTO users (name, mobile, email, password) VALUES (?, ?, ?, ?)",
      [name, mobile, email, hashedPassword]
    );
    res.json({ success: true, message: "User registered successfully" });
  } catch (err) {
    console.error("❌ Error in /register:", err);
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ success: false, message: "Email already registered" });
    }
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Login User
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const [rows] = await db.query("SELECT * FROM users WHERE email = ?", [email]);
    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: "User not found" });
    }
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(400).json({ success: false, message: "Invalid password" });
    }
    res.json({ success: true, message: "Login successful" });
  } catch (err) {
    console.error("❌ Error in /login:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Add Order (no payment)
app.post("/add-order", async (req, res) => {
  const {
    user_email,
    cart,
    total_amount,
    street,
    city,
    state,
    zip
  } = req.body;

  if (!user_email || !cart || !total_amount || !street || !city || !state || !zip) {
    return res.status(400).json({ success: false, message: "All fields required" });
  }

  try {
    // Get user id from email
    const [rows] = await db.query("SELECT id FROM users WHERE email = ?", [user_email]);
    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: "User not found" });
    }
    const user_id = rows[0].id;

    const order_id = "order_" + Date.now();
    const payment_id = "manual_" + Date.now();

    await db.query(
      `INSERT INTO orders 
      (user_id, order_id, payment_id, items, total_amount, status, street, city, state, zip) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user_id, // use numeric id, not email!
        order_id,
        payment_id,
        JSON.stringify(cart),
        total_amount,
        "pending",
        street,
        city,
        state,
        zip
      ]
    );
    res.json({ success: true, message: "Order stored!" });
  } catch (err) {
    console.error("❌ Error in /add-order:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// / Add this after your other routes
// ONLY ADD TEMPORARILY FOR DEBUGGING! REMOVE AFTER FIXING.
console.log("RAZORPAY_KEY_ID:", process.env.RAZORPAY_KEY_ID ? "Loaded" : "MISSING");
console.log("RAZORPAY_KEY_SECRET:", process.env.RAZORPAY_KEY_SECRET ? "Loaded" : "MISSING");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

app.post("/create-order", async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount) return res.status(400).json({ success: false, message: "Amount is required" });

    const options = {
      amount: amount * 100, // Razorpay expects amount in paise
      currency: "INR",
      receipt: "rcpt_" + Date.now(),
    };

    const order = await razorpay.orders.create(options);
    res.json({ order, key_id: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    console.error("❌ Razorpay error:", err);
    res.status(500).json({ success: false, message: "Payment order failed" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});