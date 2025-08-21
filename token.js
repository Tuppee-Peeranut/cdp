// server/token.js
import jwt from "jsonwebtoken";

// Load environment variables from .env
import 'dotenv/config';

const secret = process.env.ACCESS_TOKEN_SECRET;
if (!secret) {
  console.error("❌ ACCESS_TOKEN_SECRET is missing in .env");
  process.exit(1);
}

// Customize payload
const payload = {
  sub: "social@panya.io",   // your user email in Supabase
  role: "admin"             // make sure it's 'admin'
};

// Sign the token
const token = jwt.sign(payload, secret, { expiresIn: "4h" });

console.log("✅ Generated Admin JWT:\n");
console.log(token);
