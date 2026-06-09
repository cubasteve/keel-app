const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "MATIC");

  // Deploy KeelToken first
  console.log("\nDeploying KeelToken...");
  const KeelToken = await hre.ethers.getContractFactory("KeelToken");
  const keelToken = await KeelToken.deploy(deployer.address);
  await keelToken.waitForDeployment();
  const keelTokenAddress = await keelToken.getAddress();
  console.log("KeelToken deployed to:", keelTokenAddress);

  // Deploy KeelUsageLedger with KeelToken address
  console.log("\nDeploying KeelUsageLedger...");
  const KeelUsageLedger = await hre.ethers.getContractFactory("KeelUsageLedger");
  const keelLedger = await KeelUsageLedger.deploy(deployer.address, keelTokenAddress);
  await keelLedger.waitForDeployment();
  const keelLedgerAddress = await keelLedger.getAddress();
  console.log("KeelUsageLedger deployed to:", keelLedgerAddress);

  // Grant LEDGER_ROLE to KeelUsageLedger so it can burn tokens
  console.log("\nGranting LEDGER_ROLE to KeelUsageLedger...");
  const LEDGER_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("LEDGER_ROLE"));
  const tx = await keelToken.grantRole(LEDGER_ROLE, keelLedgerAddress);
  await tx.wait();
  console.log("LEDGER_ROLE granted successfully");

  console.log("\n--- DEPLOYMENT COMPLETE ---");
  console.log("KeelToken:       ", keelTokenAddress);
  console.log("KeelUsageLedger: ", keelLedgerAddress);
  console.log("Save these addresses - you will need them for the frontend and .env");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
