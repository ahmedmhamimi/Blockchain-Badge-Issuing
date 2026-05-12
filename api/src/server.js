require("dotenv").config();

const express = require("express");
const cors    = require("cors");

const { getContract, getDeployment } = require("./contract");
const { getHardhatAccounts, isHardhatAccount } = require("./accounts");
const {
  mintBadge, getBadgesByOwner, getBadge,
  revokeBadge, getBadgeHistory, getBadgeStats
} = require("./badges");
const { generateMetadata }   = require("./metadata");
const {
  initUserStore, findUserByUsername, registerStudent,
  validatePassword, getAllStudents, changeIssuerPassword
} = require("./userStore");
const { generateToken, authenticate, requireRole } = require("./middleware/auth");
const {
  normalizeError, requireText, requireAddress,
  requireTokenId, requireCategory, requireGrade
} = require("./errors");

// =============================================================================
// server.js — Modular monolith entry point
//
// Architecture note:
//   This file owns HTTP: routing, request parsing, response shaping.
//   Business logic lives in: badges.js, userStore.js, contract.js, accounts.js.
//   Auth logic lives in:     middleware/auth.js.
//   Validation lives in:     errors.js.
//   No business logic should be written inline in route handlers.
// =============================================================================

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Global middleware ────────────────────────────────────────────────────────

app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());

// ─── Startup ──────────────────────────────────────────────────────────────────

async function startup() {
  console.log("[API] Starting Badge NFT API...");

  // Try to read deployment and bootstrap user store
  // We retry a few times because the deployer may not have run yet
  let deployment = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const result = getDeployment();
    if (result.ok) {
      deployment = result.deployment;
      break;
    }
    console.log(`[API] Deployment not found (attempt ${attempt}/5). Starting anyway — run deployer.`);
    if (attempt < 5) await new Promise(r => setTimeout(r, 2000));
  }

  if (deployment) {
    await initUserStore(deployment.deployerAddress);
  } else {
    console.log("[API] Warning: No deployment found. Auth will not initialize until deployer runs.");
    // Initialize with a placeholder so the server still starts
    // The issuer wallet will be updated when deployment file appears
  }

  app.listen(PORT, () => {
    console.log(`[API] Badge NFT API running on port ${PORT}`);
    console.log(`[API] RPC URL: ${process.env.RPC_URL || "http://chain:8545"}`);
  });
}

// ─── Helper: get signer-connected contract for issuer operations ──────────────

async function getIssuerContract() {
  const depResult = getDeployment();
  if (!depResult.ok) return depResult;

  const result = await getContract(depResult.deployment.deployerAddress);
  if (!result.ok) return result;

  const signer = await result.provider.getSigner(depResult.deployment.deployerAddress);
  return { ok: true, ...result, issuerSigner: signer };
}

// =============================================================================
// AUTH ROUTES
// =============================================================================

// POST /api/auth/login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ ok: false, message: "username and password are required." });
    }

    const user = findUserByUsername(username);
    if (!user) {
      return res.status(401).json({ ok: false, message: "Invalid credentials." });
    }

    const valid = await validatePassword(user, password);
    if (!valid) {
      return res.status(401).json({ ok: false, message: "Invalid credentials." });
    }

    const token = generateToken(user);

    return res.json({
      ok:            true,
      token,
      role:          user.role,
      username:      user.username,
      walletAddress: user.walletAddress,
      studentName:   user.studentName || null
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: normalizeError(err) });
  }
});

// GET /api/auth/me  [any authenticated user]
app.get("/api/auth/me", authenticate, (req, res) => {
  return res.json({
    ok:            true,
    username:      req.user.username,
    role:          req.user.role,
    walletAddress: req.user.walletAddress
  });
});

// POST /api/auth/register-student  [issuer only]
app.post("/api/auth/register-student", authenticate, requireRole("issuer"), async (req, res) => {
  try {
    const { username, password, studentName, walletAddress } = req.body;

    const uname  = requireText(username,     "username");
    const pwd    = requireText(password,     "password");
    const sname  = requireText(studentName,  "studentName");
    const wallet = requireAddress(walletAddress, "walletAddress");

    // Validate address is a real Hardhat account
    const contractResult = await getContract();
    if (!contractResult.ok) {
      return res.status(contractResult.status || 503).json({ ok: false, message: contractResult.message });
    }

    const isValid = await isHardhatAccount(contractResult.provider, wallet);
    if (!isValid) {
      return res.status(400).json({
        ok:      false,
        message: "walletAddress must be one of the available Hardhat accounts."
      });
    }

    const student = await registerStudent({ username: uname, password: pwd, studentName: sname, walletAddress: wallet });

    return res.status(201).json({ ok: true, student });
  } catch (err) {
    const msg = normalizeError(err);
    const status = msg.includes("already") ? 409 : 400;
    return res.status(status).json({ ok: false, message: msg });
  }
});

// GET /api/auth/students  [issuer only]
app.get("/api/auth/students", authenticate, requireRole("issuer"), (req, res) => {
  try {
    const students = getAllStudents();
    return res.json({ ok: true, students, total: students.length });
  } catch (err) {
    return res.status(500).json({ ok: false, message: normalizeError(err) });
  }
});

// GET /api/auth/free-accounts  [issuer only]
// Returns Hardhat accounts (excluding #0 issuer) that are NOT yet registered as students.
// This is what the Register Student form uses so the dropdown only shows available wallets.
app.get("/api/auth/free-accounts", authenticate, requireRole("issuer"), async (req, res) => {
  try {
    const contractResult = await getContract();
    if (!contractResult.ok) {
      return res.status(contractResult.status || 503).json({ ok: false, message: contractResult.message });
    }

    const allAccounts        = await getHardhatAccounts(contractResult.provider);
    const registeredStudents = getAllStudents();
    const takenAddresses     = new Set(
      registeredStudents.map(s => s.walletAddress.toLowerCase())
    );

    // Exclude account #0 (issuer) and already-registered addresses
    const freeAccounts = allAccounts.filter(
      a => a.index !== 0 && !takenAddresses.has(a.address.toLowerCase())
    );

    return res.json({
      ok:           true,
      freeAccounts,
      total:        freeAccounts.length,
      totalTaken:   registeredStudents.length,
      slotsLeft:    freeAccounts.length
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: normalizeError(err) });
  }
});

// POST /api/auth/change-password  [issuer only]
app.post("/api/auth/change-password", authenticate, requireRole("issuer"), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    requireText(currentPassword, "currentPassword");
    requireText(newPassword,     "newPassword");

    if (newPassword.length < 6) {
      return res.status(400).json({ ok: false, message: "newPassword must be at least 6 characters." });
    }

    await changeIssuerPassword(currentPassword, newPassword);
    return res.json({ ok: true, message: "Password updated successfully." });
  } catch (err) {
    const msg = normalizeError(err);
    const status = msg.includes("incorrect") ? 401 : 400;
    return res.status(status).json({ ok: false, message: msg });
  }
});

// =============================================================================
// SYSTEM ROUTES
// =============================================================================

// GET /api/health  [public]
app.get("/api/health", async (req, res) => {
  try {
    const result = await getContract();
    if (!result.ok) {
      return res.status(result.status || 503).json({ ok: false, message: result.message });
    }

    const { contract, provider, deployment } = result;
    const blockNumber = await provider.getBlockNumber();
    const totalSupply = await contract.totalSupply();

    return res.json({
      ok:              true,
      blockNumber,
      totalBadgesMinted: Number(totalSupply),
      contractAddress: deployment.contractAddress,
      deployerAddress: deployment.deployerAddress,
      deployedAtBlock: deployment.deployedAt,
      rpcUrl:          process.env.RPC_URL || "http://chain:8545"
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: normalizeError(err) });
  }
});

// GET /api/accounts  [issuer only]
app.get("/api/accounts", authenticate, requireRole("issuer"), async (req, res) => {
  try {
    const result = await getContract();
    if (!result.ok) return res.status(result.status || 503).json({ ok: false, message: result.message });

    const accounts           = await getHardhatAccounts(result.provider);
    const registeredStudents = getAllStudents();

    return res.json({ ok: true, accounts, registeredStudents });
  } catch (err) {
    return res.status(500).json({ ok: false, message: normalizeError(err) });
  }
});

// =============================================================================
// BADGE ROUTES
// =============================================================================

// POST /api/badges/mint  [issuer only]
app.post("/api/badges/mint", authenticate, requireRole("issuer"), async (req, res) => {
  try {
    const recipient   = requireAddress(req.body.recipient,   "recipient");
    const studentName = requireText(   req.body.studentName, "studentName");
    const courseName  = requireText(   req.body.courseName,  "courseName");
    const category    = requireCategory(req.body.category);
    const grade       = requireGrade(   req.body.grade);

    const issuerResult = await getIssuerContract();
    if (!issuerResult.ok) {
      return res.status(issuerResult.status || 503).json({ ok: false, message: issuerResult.message });
    }

    const { contract, issuerSigner } = issuerResult;
    const result = await mintBadge(contract, issuerSigner, {
      recipient, studentName, courseName, category, grade
    });

    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, message: normalizeError(err) });
  }
});

// POST /api/badges/revoke  [issuer only]
app.post("/api/badges/revoke", authenticate, requireRole("issuer"), async (req, res) => {
  try {
    const tokenId = requireTokenId(req.body.tokenId);
    const reason  = requireText(req.body.reason, "reason");

    const issuerResult = await getIssuerContract();
    if (!issuerResult.ok) {
      return res.status(issuerResult.status || 503).json({ ok: false, message: issuerResult.message });
    }

    const { contract, issuerSigner } = issuerResult;
    const result = await revokeBadge(contract, issuerSigner, tokenId, reason);

    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, message: normalizeError(err) });
  }
});

// GET /api/badges/history  [issuer only]
app.get("/api/badges/history", authenticate, requireRole("issuer"), async (req, res) => {
  try {
    const result = await getContract();
    if (!result.ok) return res.status(result.status || 503).json({ ok: false, message: result.message });

    const history = await getBadgeHistory(result.contract, result.provider);
    return res.json({ ok: true, history, total: history.length });
  } catch (err) {
    return res.status(500).json({ ok: false, message: normalizeError(err) });
  }
});

// GET /api/badges/stats  [issuer only]
app.get("/api/badges/stats", authenticate, requireRole("issuer"), async (req, res) => {
  try {
    const result = await getContract();
    if (!result.ok) return res.status(result.status || 503).json({ ok: false, message: result.message });

    const stats = await getBadgeStats(result.contract, result.provider);
    return res.json({ ok: true, ...stats });
  } catch (err) {
    return res.status(500).json({ ok: false, message: normalizeError(err) });
  }
});

// GET /api/badges/owner/:address  [authenticated; students restricted to own address]
app.get("/api/badges/owner/:address", authenticate, async (req, res) => {
  try {
    const address = requireAddress(req.params.address, "address");

    // Students can only view their own badges
    if (req.user.role === "student") {
      if (address.toLowerCase() !== req.user.walletAddress.toLowerCase()) {
        return res.status(403).json({
          ok:      false,
          message: "Students can only view their own badges."
        });
      }
    }

    const result = await getContract();
    if (!result.ok) return res.status(result.status || 503).json({ ok: false, message: result.message });

    const badges = await getBadgesByOwner(result.contract, address);
    return res.json({ ok: true, owner: address, badges, total: badges.length });
  } catch (err) {
    return res.status(500).json({ ok: false, message: normalizeError(err) });
  }
});

// GET /api/badges/:tokenId/verify  [public]
app.get("/api/badges/:tokenId/verify", async (req, res) => {
  try {
    const tokenId = requireTokenId(req.params.tokenId);

    const result = await getContract();
    if (!result.ok) return res.status(result.status || 503).json({ ok: false, message: result.message });

    const [owner, exists, revoked, courseName, issuedAt] =
      await result.contract.getBadgeSummary(tokenId);

    return res.json({
      ok: true,
      tokenId,
      exists,
      owner:       exists ? owner : null,
      revoked,
      courseName:  exists ? courseName : null,
      issuedAtISO: exists && Number(issuedAt) > 0
        ? new Date(Number(issuedAt) * 1000).toISOString()
        : null
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: normalizeError(err) });
  }
});

// GET /api/badges/:tokenId  [public]
app.get("/api/badges/:tokenId", async (req, res) => {
  try {
    const tokenId = requireTokenId(req.params.tokenId);

    const result = await getContract();
    if (!result.ok) return res.status(result.status || 503).json({ ok: false, message: result.message });

    const badge = await getBadge(result.contract, tokenId);
    return res.json({ ok: true, badge });
  } catch (err) {
    const msg = normalizeError(err);
    const status = msg.includes("does not exist") ? 404 : 500;
    return res.status(status).json({ ok: false, message: msg });
  }
});

// GET /api/metadata/:tokenId  [public — OpenSea format, no ok wrapper]
app.get("/api/metadata/:tokenId", async (req, res) => {
  try {
    const tokenId = requireTokenId(req.params.tokenId);

    const result = await getContract();
    if (!result.ok) return res.status(result.status || 503).json({ ok: false, message: result.message });

    const [data] = await result.contract.getBadge(tokenId);
    const metadata = generateMetadata(tokenId, data);

    // Return raw metadata JSON — no ok wrapper (standard NFT metadata format)
    return res.json(metadata);
  } catch (err) {
    const msg = normalizeError(err);
    const status = msg.includes("does not exist") ? 404 : 500;
    return res.status(status).json({ error: msg });
  }
});

// =============================================================================
// CHAIN EXPLORER ROUTES
// =============================================================================

// GET /api/chain/blocks  [issuer only]
// Returns real block data for every block from the deployment block to latest,
// enriched with BadgeNFT event data from the history.
app.get("/api/chain/blocks", authenticate, requireRole("issuer"), async (req, res) => {
  try {
    const result = await getContract();
    if (!result.ok) return res.status(result.status || 503).json({ ok: false, message: result.message });

    const { contract, provider, deployment } = result;

    const latestBlockNum  = await provider.getBlockNumber();
    const deployedAtBlock = deployment.deployedAt || 0;

    // Fetch all badge events to know which blocks had activity
    const history = await getBadgeHistory(contract, provider);
    const eventsByBlock = {};
    history.forEach(e => {
      if (!eventsByBlock[e.blockNumber]) eventsByBlock[e.blockNumber] = [];
      eventsByBlock[e.blockNumber].push(e);
    });

    // Build the set of block numbers to fetch:
    // deployment block + all event blocks + last 5 blocks (for empty-block context)
    const blockSet = new Set();
    blockSet.add(deployedAtBlock);
    Object.keys(eventsByBlock).forEach(n => blockSet.add(Number(n)));
    const tail = Math.max(deployedAtBlock, latestBlockNum - 4);
    for (let i = tail; i <= latestBlockNum; i++) blockSet.add(i);

    const blockNums = [...blockSet].sort((a, b) => a - b);

    // Fetch real block data in parallel (capped to avoid hammering RPC)
    const blockDataArr = await Promise.all(
      blockNums.map(n => provider.getBlock(n))
    );

    const blocks = blockDataArr
      .filter(Boolean)
      .map(b => ({
        number:       b.number,
        hash:         b.hash,
        parentHash:   b.parentHash,
        timestamp:    b.timestamp,
        timestampISO: new Date(b.timestamp * 1000).toISOString(),
        gasUsed:      b.gasUsed.toString(),
        gasLimit:     b.gasLimit.toString(),
        miner:        b.miner,
        txCount:      b.transactions ? b.transactions.length : 0,
        txHashes:     b.transactions || [],
        isDeployment: b.number === deployedAtBlock,
        events:       eventsByBlock[b.number] || []
      }));

    return res.json({
      ok:              true,
      blocks,
      latestBlock:     latestBlockNum,
      deployedAtBlock,
      contractAddress: deployment.contractAddress,
      deployerAddress: deployment.deployerAddress
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: normalizeError(err) });
  }
});

// GET /api/chain/nonce  [issuer only]
// Returns the current transaction count (nonce) for the issuer wallet.
app.get("/api/chain/nonce", authenticate, requireRole("issuer"), async (req, res) => {
  try {
    const result = await getContract();
    if (!result.ok) return res.status(result.status || 503).json({ ok: false, message: result.message });

    const depResult = getDeployment();
    if (!depResult.ok) return res.status(503).json({ ok: false, message: "Deployment not found." });

    const { provider } = result;
    const issuerAddress = depResult.deployment.deployerAddress;
    const nonce = await provider.getTransactionCount(issuerAddress);

    return res.json({
      ok:            true,
      nonce,
      issuerAddress,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: normalizeError(err) });
  }
});

// GET /api/chain/ledger  [issuer only]
// Returns balances for all Hardhat accounts (the wallet ledger).
app.get("/api/chain/ledger", authenticate, requireRole("issuer"), async (req, res) => {
  try {
    const result = await getContract();
    if (!result.ok) return res.status(result.status || 503).json({ ok: false, message: result.message });

    const { provider } = result;
    const { getHardhatAccounts } = require("./accounts");
    const accounts = await getHardhatAccounts(provider);
    const students = getAllStudents();
    const studentMap = {};
    students.forEach(s => { studentMap[s.walletAddress.toLowerCase()] = s; });

    const depResult = getDeployment();
    const deployerAddr = depResult.ok ? depResult.deployment.deployerAddress.toLowerCase() : null;

    const ledger = await Promise.all(
      accounts.map(async (acc) => {
        const balanceWei = await provider.getBalance(acc.address);
        const balanceEth = parseFloat(
          (Number(balanceWei) / 1e18).toFixed(4)
        );
        const lc = acc.address.toLowerCase();
        const student = studentMap[lc];
        const isDeployer = lc === deployerAddr;
        return {
          index:       acc.index,
          address:     acc.address,
          label:       isDeployer ? "Issuer (Deployer)" : (student ? student.studentName : acc.label),
          role:        isDeployer ? "issuer" : (student ? "student" : "unassigned"),
          balanceEth,
          balanceWei:  balanceWei.toString()
        };
      })
    );

    return res.json({ ok: true, ledger });
  } catch (err) {
    return res.status(500).json({ ok: false, message: normalizeError(err) });
  }
});

// =============================================================================
// Start
// =============================================================================

startup().catch(err => {
  console.error("[API] Fatal startup error:", err);
  process.exit(1);
});