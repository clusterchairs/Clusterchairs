require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const bcrypt = require("bcrypt");
const path = require("path");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");

const app = express();
app.use(cors());
app.use(express.json());
app.use(cookieParser());
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

// Helper function to get user_id from email
async function getUserIdByEmail(email) {
  const [rows] = await db.query("SELECT id FROM users WHERE email = ?", [email]);
  if (rows.length === 0) {
    throw new Error("User not found.");
  }
  return rows[0].id;
}

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

    // 1. Set a secure, HTTP-only cookie to track the user's session 🍪
    res.cookie('userToken', user.email, {
      httpOnly: true, // Prevents client-side JavaScript access (security)
      secure: process.env.NODE_ENV === 'production', // Use secure in production (HTTPS)
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days expiration
      sameSite: 'Lax' // Good for security
    });

    // 2. We can also set a regular cookie for client-side use (like displaying the email)
    res.cookie('userEmail', user.email, {
      maxAge: 1000 * 60 * 60 * 24 * 7,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax'
    });

    res.json({ success: true, message: "Login successful", email: user.email });
  } catch (err) {
    console.error("❌ Error in /login:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// NEW LOGOUT ROUTE: To clear the cookies
app.post("/logout", (req, res) => {
  // Clear both cookies by setting their expiration date to the past
  res.clearCookie('userToken'); // ⬅️ NEW
  res.clearCookie('userEmail'); // ⬅️ NEW
  res.json({ success: true, message: "Logged out successfully" });
});


// NEW MIDDLEWARE for Auth Check (Optional, but best practice)
function protectRoute(req, res, next) {
  const userEmail = req.cookies.userToken;

  if (!userEmail) {
    // Redirect or send an error if the token is missing
    return res.status(401).json({ success: false, message: "Unauthorized: Please log in." });
  }

  // Attach the user email to the request object for use in subsequent routes
  req.userEmail = userEmail;
  next();
}

// ======================== CART (NEW) ========================

// Get Cart Items
app.get("/cart", async (req, res) => {
  const user_email = req.query.email;
  if (!user_email) {
    return res.status(400).json({ success: false, message: "User email is required" });
  }

  try {
    const user_id = await getUserIdByEmail(user_email);

    const [cartItems] = await db.query(
      "SELECT id, item_name, item_price, item_image_url, quantity FROM cart_items WHERE user_id = ?",
      [user_id]
    );

    res.json({ success: true, cart: cartItems });
  } catch (err) {
    console.error("❌ Error in /cart:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Add/Update Item in Cart
app.post("/cart/add", async (req, res) => {
  const { user_email, item_name, item_price, item_image_url, quantity } = req.body;

  if (!user_email || !item_name || !item_price || !quantity) {
    return res.status(400).json({ success: false, message: "Missing required fields for cart item" });
  }

  try {
    const user_id = await getUserIdByEmail(user_email);

    // Check if item already exists for this user
    const [existingItemRows] = await db.query(
      "SELECT id, quantity FROM cart_items WHERE user_id = ? AND item_name = ?",
      [user_id, item_name]
    );

    if (existingItemRows.length > 0) {
      // Item exists, update quantity
      const newQuantity = existingItemRows[0].quantity + quantity;
      await db.query(
        "UPDATE cart_items SET quantity = ?, created_at = NOW() WHERE id = ?",
        [newQuantity, existingItemRows[0].id]
      );
      res.json({ success: true, message: "Cart item quantity updated" });
    } else {
      // Item doesn't exist, insert new item
      await db.query(
        `INSERT INTO cart_items (user_id, item_name, item_price, item_image_url, quantity) 
                 VALUES (?, ?, ?, ?, ?)`,
        [user_id, item_name, item_price, item_image_url, quantity]
      );
      res.json({ success: true, message: "Item added to cart" });
    }
  } catch (err) {
    console.error("❌ Error in /cart/add:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Clear All Items from Cart (e.g., after successful order)
app.delete("/cart/clear", async (req, res) => {
  const { user_email } = req.body;

  if (!user_email) {
    return res.status(400).json({ success: false, message: "User email is required" });
  }

  try {
    const user_id = await getUserIdByEmail(user_email);

    await db.query(
      "DELETE FROM cart_items WHERE user_id = ?",
      [user_id]
    );

    res.json({ success: true, message: "Cart cleared successfully" });
  } catch (err) {
    console.error("❌ Error in /cart/clear:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

//======================== CART (NEW) ======================== section.


// Remove a Specific Item (all quantities) from Cart
app.delete("/cart/remove-item", async (req, res) => {
  const { user_email, item_name } = req.body; // Remove by name only, price can be ambiguous

  if (!user_email || !item_name) {
    return res.status(400).json({ success: false, message: "User email and item name are required" });
  }

  try {
    const user_id = await getUserIdByEmail(user_email);

    // Delete all rows matching the user_id and item_name
    const [result] = await db.query(
      "DELETE FROM cart_items WHERE user_id = ? AND item_name = ?",
      [user_id, item_name]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Item not found in cart" });
    }

    res.json({ success: true, message: "Item removed from cart" });
  } catch (err) {
    console.error("❌ Error in /cart/remove-item:", err.message);
    res.status(500).json({ success: false, message: err.message });
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
    const user_id = await getUserIdByEmail(user_email);

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

    // If paid order, clear the cart from the DB.
    if (isPaidOrder) {
      await db.query("DELETE FROM cart_items WHERE user_id = ?", [user_id]);
    }

    res.json({ success: true, message: "Order stored!", order_id: order_id });
  } catch (err) {
    console.error("❌ Error in /add-order:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update Tracking (Admin can update)
app.put("/update-tracking/:order_id", protectRoute, async (req, res) => {
  const { order_id } = req.params;
  const { tracking_status } = req.body;

  // 2. Use the securely stored email from the cookie (attached by middleware)
  const admin_email = req.userEmail; // <-- Change: Use req.userEmail


  if (!tracking_status || !admin_email) {
    return res.status(400).json({ success: false, message: "Tracking status required" });
  }

  try {
    // 1. CRITICAL SECURITY CHECK: Verify user is the designated admin
    const [adminRows] = await db.query(
      "SELECT id FROM users WHERE email = ? AND is_admin = 1",
      [admin_email]
    );

    if (adminRows.length === 0) {
      // Fail if the email is not found OR if is_admin is not 1
      return res.status(403).json({ success: false, message: "Permission denied. Only the designated admin can update order status." });
    }

    // 2. Perform the update (only if admin check passed)
    await db.query(
      "UPDATE orders SET tracking_status = ? WHERE order_id = ?",
      [tracking_status, order_id]
    );

    // 3. Add a record in tracking history
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
app.get("/get-orders", protectRoute, async (req, res) => {
  const user_email = req.userEmail;

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

// Razorpay Verification (NEW: Recommended for production to verify signature)
app.post("/verify-payment", (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature
  } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ success: false, message: "Missing payment verification fields" });
  }

  const shasum = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
  shasum.update(`${razorpay_order_id}|${razorpay_payment_id}`);
  const digest = shasum.digest('hex');

  if (digest === razorpay_signature) {
    // Payment is verified. In a more complex flow, you would update the order status here.
    // For your current flow, /add-order handles the final save and cart clear after this verification.
    res.json({ success: true, message: "Payment verified successfully" });
  } else {
    res.status(400).json({ success: false, message: "Invalid signature: Payment verification failed" });
  }
});

// ======================== SERVER ========================

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
