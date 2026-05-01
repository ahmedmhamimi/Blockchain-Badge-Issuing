const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[0];

  console.log("═══════════════════════════════════════════════");
  console.log("  BadgeNFT Deployer");
  console.log("═══════════════════════════════════════════════");
  console.log(`  Deployer address : ${deployer.address}`);
  console.log("");

  // Print all 10 Hardhat accounts for student registration reference
  console.log("  Hardhat accounts (use for student registration):");
  for (let i = 0; i < Math.min(signers.length, 10); i++) {
    const label = i === 0 ? " [Issuer]" : ` [Student #${i}]`;
    console.log(`    Account #${i}${label}: ${signers[i].address}`);
  }
  console.log("");

  // Deploy contract
  console.log("  Deploying BadgeNFT...");
  const BadgeNFT = await ethers.getContractFactory("BadgeNFT");
  const contract = await BadgeNFT.deploy();
  const deployTx = contract.deploymentTransaction();
  const receipt  = await deployTx.wait();

  console.log(`  Contract address : ${contract.target}`);
  console.log(`  Deployed at block: ${receipt.blockNumber}`);
  console.log("");

  // Build ABI from artifact
  const artifactPath = path.resolve(
    __dirname,
    "../artifacts/contracts/BadgeNFT.sol/BadgeNFT.json"
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

  const deployment = {
    contractAddress: contract.target,
    deployerAddress: deployer.address,
    deployedAt:      receipt.blockNumber,
    abi:             artifact.abi
  };

  // Write to API deployments directory (Docker volume mount)
  const apiDeployPath = "/api/deployments/localhost.json";
  const localDeployPath = path.resolve(__dirname, "../deployments/localhost.json");

  // Ensure directories exist
  fs.mkdirSync(path.dirname(apiDeployPath),   { recursive: true });
  fs.mkdirSync(path.dirname(localDeployPath), { recursive: true });

  fs.writeFileSync(apiDeployPath,   JSON.stringify(deployment, null, 2));
  fs.writeFileSync(localDeployPath, JSON.stringify(deployment, null, 2));

  console.log(`  Deployment written to: ${apiDeployPath}`);
  console.log(`  Deployment written to: ${localDeployPath}`);
  console.log("");
  console.log("  ✓ BadgeNFT deployed successfully.");
  console.log("═══════════════════════════════════════════════");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
