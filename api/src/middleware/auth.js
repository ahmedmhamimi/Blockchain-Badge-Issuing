const jwt = require("jsonwebtoken");

// =============================================================================
// middleware/auth.js — JWT authentication and role-based access control
// =============================================================================

const JWT_SECRET     = process.env.JWT_SECRET || "dev_secret_change_in_production";
const ISSUER_EXPIRY  = "8h";
const STUDENT_EXPIRY = "4h";

// ─── Token generation ─────────────────────────────────────────────────────────

/**
 * Signs a JWT for a user. Expiry differs by role.
 */
function generateToken(user) {
  const expiry = user.role === "issuer" ? ISSUER_EXPIRY : STUDENT_EXPIRY;
  return jwt.sign(
    {
      username:      user.username,
      role:          user.role,
      walletAddress: user.walletAddress
    },
    JWT_SECRET,
    { expiresIn: expiry }
  );
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Requires a valid Bearer token. Attaches decoded payload to req.user.
 * Returns 401 if token is missing or invalid.
 */
function authenticate(req, res, next) {
  const header = req.headers["authorization"];

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ ok: false, message: "Authentication required." });
  }

  const token = header.slice(7); // remove "Bearer "

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      username:      decoded.username,
      role:          decoded.role,
      walletAddress: decoded.walletAddress
    };
    next();
  } catch {
    return res.status(401).json({ ok: false, message: "Invalid or expired token." });
  }
}

/**
 * Factory that returns middleware enforcing one or more allowed roles.
 * Must be used AFTER authenticate.
 *
 * Usage: router.post("/mint", authenticate, requireRole("issuer"), handler)
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, message: "Authentication required." });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        ok:      false,
        message: `Access denied. Required role: ${roles.join(" or ")}.`
      });
    }
    next();
  };
}

/**
 * Optional auth — attaches req.user if a valid token is present,
 * but never blocks the request. Used for public endpoints that
 * benefit from knowing who is asking (e.g. self-lookup vs issuer lookup).
 */
function optionalAuth(req, res, next) {
  const header = req.headers["authorization"];
  if (header && header.startsWith("Bearer ")) {
    try {
      const decoded = jwt.verify(header.slice(7), JWT_SECRET);
      req.user = {
        username:      decoded.username,
        role:          decoded.role,
        walletAddress: decoded.walletAddress
      };
    } catch {
      // Invalid token — treat as unauthenticated
      req.user = undefined;
    }
  }
  next();
}

module.exports = { generateToken, authenticate, requireRole, optionalAuth };
