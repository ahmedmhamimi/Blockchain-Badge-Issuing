# Course Completion Badge NFT Platform

A blockchain-backed badge system where instructors mint soul-bound NFT achievement tokens for students. Built on a local Hardhat Ethereum chain with JWT authentication, a Node.js API, and a plain HTML/CSS/JS frontend — all running in Docker.

---

## Quick Start

```bash
# 1. Start the local blockchain (wait for it to become healthy — ~5s)
docker compose up -d chain

# 2. Deploy the BadgeNFT smart contract (one-shot — exits when done)
docker compose run --rm deployer

# 3. Start the API and frontend
docker compose up -d api frontend
```

Then open: **http://localhost:8080**
API health: http://localhost:3000/api/health

---

## Default Credentials

| Role   | Username | Password   | Wallet             |
|--------|----------|------------|--------------------|
| Issuer | `issuer` | `issuer1234` | Hardhat Account #0 |

Students are registered by the issuer via the platform UI (Students tab → Register Student).

---

## Architecture

```
Browser (8080)
  └── nginx (static frontend)
        └── fetch() → Node.js API (3000)
              ├── JWT auth middleware
              ├── ethers.js → Hardhat chain (8545)
              │     └── BadgeNFT.sol
              └── users.json (Docker named volume)
```

### Modular structure

```
api/src/
  server.js       ← Express app, route registration only
  contract.js     ← Deployment loader + ethers contract factory
  badges.js       ← mintBadge, getBadgesByOwner, getBadgeHistory, getBadgeStats
  metadata.js     ← generateMetadata (OpenSea-compatible JSON)
  accounts.js     ← getHardhatAccounts, isHardhatAccount
  userStore.js    ← File-based user store, bcrypt password hashing
  errors.js       ← normalizeError, requireText, requireAddress, requireGrade
  middleware/
    auth.js       ← generateToken, authenticate, requireRole, optionalAuth
```

---

## API Reference

### Auth

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| POST | `/api/auth/login` | No | — | Login, returns JWT |
| GET | `/api/auth/me` | Yes | any | Returns current user |
| POST | `/api/auth/register-student` | Yes | issuer | Register a student |
| GET | `/api/auth/students` | Yes | issuer | List all students |
| POST | `/api/auth/change-password` | Yes | issuer | Change issuer password |

### System

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | No | Chain status + contract info |
| GET | `/api/accounts` | Yes (issuer) | Hardhat accounts + registered students |

### Badges

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| POST | `/api/badges/mint` | Yes | issuer | Mint a new badge |
| POST | `/api/badges/revoke` | Yes | issuer | Revoke a badge |
| GET | `/api/badges/history` | Yes | issuer | Full event log |
| GET | `/api/badges/stats` | Yes | issuer | Minted/revoked stats by category & grade |
| GET | `/api/badges/owner/:address` | Yes | any* | Badges owned by address |
| GET | `/api/badges/:tokenId` | No | — | Single badge data |
| GET | `/api/badges/:tokenId/verify` | No | — | Public verification |
| GET | `/api/metadata/:tokenId` | No | — | OpenSea-format metadata |

*Students can only query their own wallet address.

---

## Registering a Student (via curl)

```bash
# 1. Login as issuer
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"issuer","password":"issuer1234"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)

# 2. Check available Hardhat accounts
curl -s http://localhost:3000/api/accounts \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# 3. Register a student using one of the account addresses
curl -X POST http://localhost:3000/api/auth/register-student \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "username": "alice",
    "password": "alice1234",
    "studentName": "Alice Mahmoud",
    "walletAddress": "<paste Hardhat Account #1 address here>"
  }'
```

---

## Smart Contract: BadgeNFT.sol

- **Soul-bound**: `transfer()`, `approve()`, `setApprovalForAll()` all revert.
- **Issuer-only**: `mintBadge()` and `revokeBadge()` require `msg.sender == issuer`.
- **Audit trail**: `BadgeMinted` and `BadgeRevoked` events queryable from block 0.
- **Categories**: Blockchain · Web Dev · Security · Data Science
- **Grades**: Bronze · Silver · Gold
- **Revocation**: Marks badge invalid on-chain; history stays for audit.

---

## Stopping

```bash
docker compose down        # stop containers, preserve user data (users.json)
docker compose down -v     # stop + delete volumes (resets user data, full clean)
```

---

## Troubleshooting

**Frontend opens but shows no contract data**
```bash
docker compose run --rm deployer
docker compose restart api
```

**API logs**
```bash
docker compose logs -f api
```

**Chain logs**
```bash
docker compose logs -f chain
```

**Reset everything**
```bash
docker compose down -v
docker compose up -d chain
docker compose run --rm deployer
docker compose up -d api frontend
```
