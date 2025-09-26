const jwt = require("jsonwebtoken");
const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const bcrypt = require("bcrypt");
const Razorpay = require("razorpay");
const crypto = require("crypto");
require("dotenv").config();


// JWT Secret Key
const JWT_SECRET = process.env.JWT_SECRET;

const app = express();
app.use(cors());
app.use(express.json());

// MySQL connection
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
};

// Authentication Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) {
        return res.status(401).json({ success: false, message: "Access denied. No token provided." });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: "Invalid or expired token." });
        }
        req.user = user;
        next();
    });
};

let db;
(async () => {
    db = await mysql.createPool(dbConfig);
    console.log("✅ Connected to MySQL");
})();

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

        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ success: true, message: "Login successful", token });

    } catch (err) {
        console.error("❌ Error in /login:", err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// Razorpay Integration
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// === UPDATED: /create-order route ===
// Now accepts 'items' and 'address' and saves them to the database.
app.post("/create-order", authenticateToken, async (req, res) => {
    try {
        const { amount, items, address } = req.body; // Extract 'items' and 'address'
        if (!amount || !items || !address) {
            return res.status(400).json({ success: false, message: "Amount, items, and address are required" });
        }
        
        // 1. Create the Razorpay order
        const options = {
            amount: amount * 100, // Razorpay uses smallest currency unit (paise)
            currency: "INR",
            receipt: "rcpt_" + Date.now(),
        };
        const order = await razorpay.orders.create(options);

        // 2. Save the order details in your database, including the address
        await db.query(
            "INSERT INTO orders (user_id, order_id, items, total_amount, status, street, city, state, zip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [req.user.userId, order.id, JSON.stringify(items), amount, 'created', address.street, address.city, address.state, address.zip]
        );
        
        res.json(order);
    } catch (err) {
        console.error("❌ Razorpay order creation or DB insertion failed:", err);
        res.status(500).json({ success: false, message: "Payment order failed" });
    }
});

// === UPDATED: /verify-payment route ===
// Now updates the order status in the database upon successful verification.
app.post("/verify-payment", async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    try {
        const sign = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSign = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(sign.toString())
            .digest("hex");

        if (expectedSign === razorpay_signature) {
            // Payment is valid, update the order status in the database
            await db.query(
                "UPDATE orders SET status = ?, razorpay_payment_id = ? WHERE order_id = ?",
                ['paid', razorpay_payment_id, razorpay_order_id]
            );

            return res.json({ success: true, message: "Payment verified successfully" });
        } else {
            // Payment signature mismatch
            return res.status(400).json({ success: false, message: "Invalid signature" });
        }
    } catch (err) {
        console.error("❌ Error in /verify-payment:", err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});