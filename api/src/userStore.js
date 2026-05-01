const bcrypt = require("bcryptjs");
const fs     = require("fs");
const path   = require("path");

// =============================================================================
// userStore.js — File-based user store (no database)
// Persists to api/data/users.json inside a Docker named volume.
// =============================================================================

const DATA_PATH    = path.resolve(__dirname, "../data/users.json");
const BCRYPT_ROUNDS = 10;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function ensureDir() {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
}

/**
 * Reads users.json from disk. Returns default empty structure if missing.
 */
function loadUsers() {
  if (!fs.existsSync(DATA_PATH)) {
    return { issuer: null, students: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  } catch {
    return { issuer: null, students: [] };
  }
}

/**
 * Writes the users object to disk as formatted JSON.
 */
function saveUsers(usersObj) {
  ensureDir();
  fs.writeFileSync(DATA_PATH, JSON.stringify(usersObj, null, 2), "utf8");
}

// ─── Exported functions ───────────────────────────────────────────────────────

/**
 * Called once on API startup. Creates the issuer account if users.json
 * does not exist yet, or updates the wallet address if the contract
 * was redeployed.
 *
 * @param {string} issuerWalletAddress - Pulled from deployments/localhost.json
 */
async function initUserStore(issuerWalletAddress) {
  const users = loadUsers();

  if (!users.issuer) {
    const passwordHash = await bcrypt.hash("issuer1234", BCRYPT_ROUNDS);
    users.issuer = {
      username:      "issuer",
      passwordHash,
      walletAddress: issuerWalletAddress,
      role:          "issuer"
    };
    saveUsers(users);
    console.log("[UserStore] Issuer account created. Default password: issuer1234");
  } else if (users.issuer.walletAddress !== issuerWalletAddress) {
    // Contract redeployed — update wallet address
    users.issuer.walletAddress = issuerWalletAddress;
    saveUsers(users);
    console.log("[UserStore] Issuer wallet address updated after redeploy.");
  } else {
    console.log("[UserStore] Existing user store loaded.");
  }

  return users;
}

/**
 * Finds a user by username. Checks issuer first, then students.
 * Returns null if not found.
 */
function findUserByUsername(username) {
  const users = loadUsers();
  if (users.issuer && users.issuer.username === username) return users.issuer;
  return users.students.find(s => s.username === username) || null;
}

/**
 * Registers a new student. Throws if username or wallet is already taken.
 * Returns the student object without passwordHash.
 */
async function registerStudent({ username, password, studentName, walletAddress }) {
  const users = loadUsers();

  // Check for duplicate username
  const usernameTaken =
    (users.issuer && users.issuer.username === username) ||
    users.students.some(s => s.username === username);
  if (usernameTaken) throw new Error("Username already exists.");

  // Check for duplicate wallet address
  const walletTaken =
    (users.issuer && users.issuer.walletAddress.toLowerCase() === walletAddress.toLowerCase()) ||
    users.students.some(s => s.walletAddress.toLowerCase() === walletAddress.toLowerCase());
  if (walletTaken) throw new Error("Wallet address already registered.");

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const student = {
    username,
    passwordHash,
    walletAddress,
    studentName,
    role: "student"
  };

  users.students.push(student);
  saveUsers(users);

  // Return without passwordHash
  const { passwordHash: _, ...safeStudent } = student;
  return safeStudent;
}

/**
 * Compares a plain-text password against the stored bcrypt hash.
 */
async function validatePassword(user, plainPassword) {
  return bcrypt.compare(plainPassword, user.passwordHash);
}

/**
 * Returns all registered students without their passwordHash fields.
 */
function getAllStudents() {
  const users = loadUsers();
  return users.students.map(({ passwordHash: _, ...s }) => s);
}

/**
 * Changes the issuer's password after verifying the current one.
 */
async function changeIssuerPassword(currentPassword, newPassword) {
  const users = loadUsers();
  if (!users.issuer) throw new Error("Issuer account not found.");

  const valid = await bcrypt.compare(currentPassword, users.issuer.passwordHash);
  if (!valid) throw new Error("Current password is incorrect.");

  users.issuer.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  saveUsers(users);
}

module.exports = {
  initUserStore,
  findUserByUsername,
  registerStudent,
  validatePassword,
  getAllStudents,
  changeIssuerPassword
};
