// =============================================================================
// badges.js — Badge domain logic
// All functions take ethers contract/provider instances as arguments.
// No HTTP concerns live here — that is server.js's job.
// =============================================================================

/**
 * Converts raw contract BadgeData + extras into a clean plain object.
 */
function formatBadge(tokenId, data, revoked, reason, uri) {
  return {
    tokenId:          Number(tokenId),
    studentName:      data.studentName,
    courseName:       data.courseName,
    category:         data.category,
    grade:            data.grade,
    recipient:        data.recipient,
    issuedAt:         Number(data.issuedAt),
    issuedAtISO:      new Date(Number(data.issuedAt) * 1000).toISOString(),
    exists:           data.exists,
    revoked:          revoked,
    revocationReason: reason || null,
    tokenURI:         uri
  };
}

/**
 * Mints a new badge NFT.
 * The issuerSigner must be a connected ethers Signer (from provider.getSigner(address)).
 *
 * @returns {{ tokenId, txHash, blockNumber, badge }}
 */
async function mintBadge(contract, issuerSigner, { recipient, studentName, courseName, category, grade }) {
  // Compute the next token ID before sending (totalSupply + 1)
  const currentSupply = await contract.totalSupply();
  const nextId        = Number(currentSupply) + 1;
  const uri           = `http://localhost:3000/api/metadata/${nextId}`;

  // Connect contract to the signer for write operations
  const connected = contract.connect(issuerSigner);

  const tx      = await connected.mintBadge(recipient, studentName, courseName, category, grade, uri);
  const receipt  = await tx.wait();

  // Parse the BadgeMinted event from logs to get the canonical tokenId
  const parsedLogs = receipt.logs
    .map(log => { try { return contract.interface.parseLog(log); } catch { return null; } })
    .filter(Boolean);

  const mintEvent = parsedLogs.find(e => e.name === "BadgeMinted");
  if (!mintEvent) throw new Error("BadgeMinted event not found in transaction receipt.");

  const tokenId = Number(mintEvent.args.tokenId);

  // Fetch the stored badge data to return complete info
  const [data, revoked, reason, storedUri] = await contract.getBadge(tokenId);

  return {
    tokenId,
    txHash:      tx.hash,
    blockNumber: receipt.blockNumber,
    badge:       formatBadge(tokenId, data, revoked, reason, storedUri)
  };
}

/**
 * Returns all badges owned by a given wallet address.
 *
 * @returns {Array<object>} array of formatted badge objects (may be empty)
 */
async function getBadgesByOwner(contract, ownerAddress) {
  const tokenIds = await contract.getTokensByOwner(ownerAddress);
  if (!tokenIds || tokenIds.length === 0) return [];

  const badges = await Promise.all(
    tokenIds.map(async (id) => {
      const [data, revoked, reason, uri] = await contract.getBadge(id);
      return formatBadge(Number(id), data, revoked, reason, uri);
    })
  );

  return badges;
}

/**
 * Returns the full data for a single badge by token ID.
 */
async function getBadge(contract, tokenId) {
  const [data, revoked, reason, uri] = await contract.getBadge(tokenId);
  return formatBadge(tokenId, data, revoked, reason, uri);
}

/**
 * Revokes a badge. issuerSigner must be a connected ethers Signer.
 *
 * @returns {{ txHash, blockNumber, badge }}
 */
async function revokeBadge(contract, issuerSigner, tokenId, reason) {
  const connected = contract.connect(issuerSigner);

  const tx      = await connected.revokeBadge(tokenId, reason);
  const receipt  = await tx.wait();

  const [data, revoked, revokeReason, uri] = await contract.getBadge(tokenId);

  return {
    txHash:      tx.hash,
    blockNumber: receipt.blockNumber,
    badge:       formatBadge(tokenId, data, revoked, revokeReason, uri)
  };
}

/**
 * Queries all BadgeMinted and BadgeRevoked events from the chain.
 * Fetches block timestamps and merges them in.
 *
 * @returns {Array<object>} sorted array of event objects (ascending blockNumber)
 */
async function getBadgeHistory(contract, provider) {
  const [mintedLogs, revokedLogs] = await Promise.all([
    contract.queryFilter(contract.filters.BadgeMinted(),  0, "latest"),
    contract.queryFilter(contract.filters.BadgeRevoked(), 0, "latest")
  ]);

  // Collect unique block numbers across both event sets
  const blockNumbers = new Set([
    ...mintedLogs.map(l => l.blockNumber),
    ...revokedLogs.map(l => l.blockNumber)
  ]);

  // Fetch all blocks in parallel for timestamps
  const blockMap = {};
  await Promise.all(
    [...blockNumbers].map(async (num) => {
      const block = await provider.getBlock(num);
      blockMap[num] = block ? block.timestamp : 0;
    })
  );

  const mintEvents = mintedLogs.map(log => {
    const args = log.args;
    return {
      event:       "BadgeMinted",
      tokenId:     Number(args.tokenId),
      recipient:   args.recipient,
      courseName:  args.courseName,
      category:    args.category,
      issuer:      args.issuer,
      txHash:      log.transactionHash,
      blockNumber: log.blockNumber,
      timestamp:   blockMap[log.blockNumber] || 0,
      timestampISO: blockMap[log.blockNumber]
        ? new Date(blockMap[log.blockNumber] * 1000).toISOString()
        : null
    };
  });

  const revokeEvents = revokedLogs.map(log => {
    const args = log.args;
    return {
      event:       "BadgeRevoked",
      tokenId:     Number(args.tokenId),
      reason:      args.reason,
      issuer:      args.issuer,
      txHash:      log.transactionHash,
      blockNumber: log.blockNumber,
      timestamp:   blockMap[log.blockNumber] || 0,
      timestampISO: blockMap[log.blockNumber]
        ? new Date(blockMap[log.blockNumber] * 1000).toISOString()
        : null
    };
  });

  // Merge and sort ascending by blockNumber
  return [...mintEvents, ...revokeEvents].sort((a, b) => a.blockNumber - b.blockNumber);
}

/**
 * Returns badge statistics across all minted badges.
 * Used by the bonus stats endpoint.
 */
async function getBadgeStats(contract, provider) {
  const totalSupply = Number(await contract.totalSupply());
  const history     = await getBadgeHistory(contract, provider);

  const byCategory = { "Blockchain": 0, "Web Dev": 0, "Security": 0, "Data Science": 0 };
  const byGrade    = { "Bronze": 0, "Silver": 0, "Gold": 0 };
  let   totalRevoked = 0;

  const mintEvents = history.filter(e => e.event === "BadgeMinted");
  const revokeEvents = history.filter(e => e.event === "BadgeRevoked");

  totalRevoked = revokeEvents.length;

  // Fetch badge details for each minted event to get grade info
  await Promise.all(
    mintEvents.map(async (e) => {
      try {
        const [data] = await contract.getBadge(e.tokenId);
        if (byCategory[data.category] !== undefined) byCategory[data.category]++;
        if (byGrade[data.grade]       !== undefined) byGrade[data.grade]++;
      } catch {
        // token may not exist if something went wrong
      }
    })
  );

  return { totalMinted: totalSupply, totalRevoked, byCategory, byGrade };
}

module.exports = {
  mintBadge,
  getBadgesByOwner,
  getBadge,
  revokeBadge,
  getBadgeHistory,
  getBadgeStats
};
