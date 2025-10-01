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

// ======================== AUTH ========================

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

// ======================== ORDERS ========================

// Add Order (supports both paid and pending orders)
app.post("/add-order", async (req, res) => {
  const {
    user_email,
    cart,
    total_amount,
    street,
    city,
    state,
    zip,
    razorpay_order_id,
    razorpay_payment_id,
    payment_status // expecting "paid"
  } = req.body;

  if (!user_email || !cart || !total_amount || !street || !city || !state || !zip) {
    return res.status(400).json({ success: false, message: "All required fields are missing" });
  }

  const isPaidOrder = !!razorpay_order_id && payment_status === "paid";

  const status = isPaidOrder ? "paid" : "pending";
  const order_id = isPaidOrder ? razorpay_order_id : ("order_" + Date.now());
  const payment_id = isPaidOrder ? razorpay_payment_id : ("manual_" + Date.now());
  const tracking_status = "pending"; // NEW: Tracking always starts with "pending"

  try {
    const [rows] = await db.query("SELECT id FROM users WHERE email = ?", [user_email]);
    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: "User not found" });
    }
    const user_id = rows[0].id;

    await db.query(
      `INSERT INTO orders 
      (user_id, order_id, payment_id, items, total_amount, status, tracking_status, street, city, state, zip) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user_id,
        order_id,
        payment_id,
        JSON.stringify(cart),
        total_amount,
        status,
        tracking_status,
        street,
        city,
        state,
        zip
      ]
    );

    // insert first tracking history
    await db.query(
      "INSERT INTO tracking_history (order_id, status) VALUES (?, ?)",
      [order_id, tracking_status]
    );

    res.json({ success: true, message: "Order stored!" });
  } catch (err) {
    console.error("❌ Error in /add-order:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update Tracking (Admin can update)
app.put("/update-tracking/:order_id", async (req, res) => {
  const { order_id } = req.params;
  const { tracking_status } = req.body;

  if (!tracking_status) {
    return res.status(400).json({ success: false, message: "Tracking status required" });
  }

  try {
    await db.query(
      "UPDATE orders SET tracking_status = ? WHERE order_id = ?",
      [tracking_status, order_id]
    );

    // Add a record in tracking history
    await db.query(
      "INSERT INTO tracking_history (order_id, status) VALUES (?, ?)",
      [order_id, tracking_status]
    );

    res.json({ success: true, message: "Tracking status updated" });
  } catch (err) {
    console.error("❌ Error updating tracking:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Get Orders for a specific user
app.get("/get-orders", async (req, res) => {
  const user_email = req.query.email;

  if (!user_email) {
    return res.status(400).json({ success: false, message: "User email is required." });
  }

  try {
    const [userRows] = await db.query("SELECT id FROM users WHERE email = ?", [user_email]);
    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    const user_id = userRows[0].id;

    const [orderRows] = await db.query(
      `SELECT order_id, payment_id, items, total_amount, status, tracking_status, street, city, state, zip, created_at, updated_at
       FROM orders 
       WHERE user_id = ? 
       ORDER BY created_at DESC`,
      [user_id]
    );

    const orders = await Promise.all(orderRows.map(async (order) => {
      const [history] = await db.query(
        "SELECT status, updated_at FROM tracking_history WHERE order_id = ? ORDER BY updated_at ASC",
        [order.order_id]
      );

      return {
        ...order,
        cart: JSON.parse(order.items),
        _id: order.order_id,
        tracking_history: history
      };
    }));

    res.json({ success: true, orders });
  } catch (err) {
    console.error("❌ Error fetching orders:", err);
    res.status(500).json({ success: false, message: "Internal server error while fetching orders." });
  }
});

// ======================== RAZORPAY ========================

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

app.post("/create-order", async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount) return res.status(400).json({ success: false, message: "Amount is required" });

    const options = {
      amount: amount * 100,
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

// ======================== SERVER ========================

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
