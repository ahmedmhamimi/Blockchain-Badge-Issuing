const { ethers } = require("ethers");

// =============================================================================
// errors.js — Input validation helpers and error normalization
// =============================================================================

/**
 * Extracts a human-readable message from ethers errors or standard errors.
 */
function normalizeError(err) {
  if (err?.reason)       return err.reason;
  if (err?.shortMessage) return err.shortMessage;
  if (err?.message)      return err.message;
  return "Unknown error occurred.";
}

/**
 * Validates a required non-empty string field.
 * Throws if missing or empty.
 */
function requireText(value, fieldName) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${fieldName} is required and must be a non-empty string.`);
  }
  return String(value).trim();
}

/**
 * Validates a required Ethereum address.
 * Throws if invalid.
 */
function requireAddress(value, fieldName) {
  if (!value || !ethers.isAddress(value)) {
    throw new Error(`${fieldName} must be a valid Ethereum address.`);
  }
  return value;
}

/**
 * Validates a token ID (positive integer).
 * Throws if invalid.
 */
function requireTokenId(value) {
  const id = parseInt(value, 10);
  if (isNaN(id) || id <= 0) {
    throw new Error("tokenId must be a positive integer.");
  }
  return id;
}

/**
 * Validates that a category is one of the allowed values.
 */
function requireCategory(value) {
  const allowed = ["Blockchain", "Web Dev", "Security", "Data Science"];
  const v = requireText(value, "category");
  if (!allowed.includes(v)) {
    throw new Error(`category must be one of: ${allowed.join(", ")}.`);
  }
  return v;
}

/**
 * Validates that a grade is one of the allowed values.
 */
function requireGrade(value) {
  const allowed = ["Bronze", "Silver", "Gold"];
  const v = requireText(value, "grade");
  if (!allowed.includes(v)) {
    throw new Error(`grade must be one of: ${allowed.join(", ")}.`);
  }
  return v;
}

module.exports = {
  normalizeError,
  requireText,
  requireAddress,
  requireTokenId,
  requireCategory,
  requireGrade
};
