// =============================================================================
// accounts.js — Hardhat account helpers
// =============================================================================

/**
 * Returns the first N Hardhat accounts with labels.
 */
async function getHardhatAccounts(provider, count = 10) {
  const signers = await provider.listAccounts();
  return signers.slice(0, count).map((signer, i) => ({
    index:   i,
    address: signer.address,
    label:   i === 0 ? "Account #0 [Issuer]" : `Account #${i} [Student]`
  }));
}

/**
 * Returns the issuer account (index 0).
 */
async function getIssuerAccount(provider) {
  const accounts = await getHardhatAccounts(provider, 1);
  return accounts[0];
}

/**
 * Finds an account by address (case-insensitive).
 * Returns null if not found.
 */
async function getAccountByAddress(provider, address) {
  const accounts = await getHardhatAccounts(provider);
  return accounts.find(
    a => a.address.toLowerCase() === address.toLowerCase()
  ) || null;
}

/**
 * Checks whether an address is one of the available Hardhat accounts.
 */
async function isHardhatAccount(provider, address) {
  const match = await getAccountByAddress(provider, address);
  return match !== null;
}

module.exports = {
  getHardhatAccounts,
  getIssuerAccount,
  getAccountByAddress,
  isHardhatAccount
};
