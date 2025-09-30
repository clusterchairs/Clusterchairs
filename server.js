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
    // NEW: Fields sent by the frontend after a successful Razorpay payment
    razorpay_order_id,
    razorpay_payment_id,
    payment_status // expecting "paid"
  } = req.body;

  // Basic validation (All fields from the address form are required)
  if (!user_email || !cart || !total_amount || !street || !city || !state || !zip) {
    return res.status(400).json({ success: false, message: "All required fields are missing" });
  }

  // --- Determine Order Details based on payment status ---
  const isPaidOrder = !!razorpay_order_id && payment_status === "paid";

  // If paid, use the status and IDs from the client; otherwise, default to manual/pending
  const status = isPaidOrder ? "paid" : "pending";
  const order_id = isPaidOrder ? razorpay_order_id : ("order_" + Date.now());
  const payment_id = isPaidOrder ? razorpay_payment_id : ("manual_" + Date.now());
  // --------------------------------------------------------

  try {
    // 1. Get user id from email
    const [rows] = await db.query("SELECT id FROM users WHERE email = ?", [user_email]);
    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: "User not found" });
    }
    const user_id = rows[0].id;

    // 2. Insert order into the database
    await db.query(
      `INSERT INTO orders 
      (user_id, order_id, payment_id, items, total_amount, status, street, city, state, zip) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user_id, // Foreign key to users table
        order_id, // Uses Razorpay ID for paid, or custom ID for manual
        payment_id, // Uses Razorpay ID for paid, or custom ID for manual
        JSON.stringify(cart), // Cart contents stored as a JSON string
        total_amount,
        status, // 'paid' or 'pending'
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


// Get Orders for a specific user
app.get("/get-orders", async (req, res) => {
  // 1. Get the user's email from the query string (e.g., /get-orders?email=user@example.com)
  const user_email = req.query.email;

  if (!user_email) {
    return res.status(400).json({ success: false, message: "User email is required." });
  }

  try {
    // 2. First, get the numeric user_id from the email
    const [userRows] = await db.query("SELECT id FROM users WHERE email = ?", [user_email]);
    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    const user_id = userRows[0].id;

    // 3. Retrieve all orders for that user_id, sorted by the most recent first
    const [orderRows] = await db.query(
      `SELECT order_id, payment_id, items, total_amount, status, street, city, state, zip, order_date 
       FROM orders 
       WHERE user_id = ? 
       ORDER BY order_date DESC`,
      [user_id]
    );

    // 4. Format the items field (which is a JSON string) back into an object
    const orders = orderRows.map(order => ({
      ...order,
      // The 'items' column is a JSON string in MySQL, so parse it back to a JS object
      cart: JSON.parse(order.items),
      // Rename or include fields to match frontend expectation
      _id: order.order_id // Use order_id as a unique identifier for the frontend
    }));

    // 5. Send the list of orders back to the frontend (order.html)
    res.json({ success: true, orders });
  } catch (err) {
    console.error("❌ Error fetching orders:", err);
    res.status(500).json({ success: false, message: "Internal server error while fetching orders." });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});