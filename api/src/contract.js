const { ethers } = require("ethers");
const fs   = require("fs");
const path = require("path");

// =============================================================================
// contract.js — Deployment loader and ethers contract factory
// =============================================================================

const DEPLOYMENT_PATH = path.resolve(__dirname, "../deployments/localhost.json");
const RPC_URL         = process.env.RPC_URL || "http://chain:8545";

/**
 * Reads and returns the deployment JSON written by the deployer container.
 * Returns an error object if the file does not exist yet.
 */
function getDeployment() {
  if (!fs.existsSync(DEPLOYMENT_PATH)) {
    return {
      ok:      false,
      status:  503,
      message: "Contract not deployed yet. Run the deployer first."
    };
  }
  try {
    const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, "utf8"));
    return { ok: true, deployment };
  } catch (err) {
    return {
      ok:      false,
      status:  503,
      message: "Failed to read deployment file: " + err.message
    };
  }
}

/**
 * Returns a read-only or signer-connected contract instance.
 *
 * @param {string} [signerAddress] - If provided, returns a signer-connected
 *   contract. If omitted, returns a read-only contract.
 *
 * @returns {{ ok, contract, provider, deployment } | { ok, status, message }}
 */
async function getContract(signerAddress) {
  const depResult = getDeployment();
  if (!depResult.ok) return depResult;

  const { deployment } = depResult;
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  let contract;
  if (signerAddress) {
    const signer = await provider.getSigner(signerAddress);
    contract = new ethers.Contract(deployment.contractAddress, deployment.abi, signer);
  } else {
    contract = new ethers.Contract(deployment.contractAddress, deployment.abi, provider);
  }

  return { ok: true, contract, provider, deployment };
}

module.exports = { getDeployment, getContract };
