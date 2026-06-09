// deploy-upgradeable.js — deploys UUPS proxy versions of KeelToken + KeelUsageLedger.
// Run once. After this, use upgrade-token.js / upgrade-ledger.js for all future changes.
// Proxy addresses are PERMANENT — update KEEL_TOKEN_ADDRESS and KEEL_LEDGER_ADDRESS in index.html.

const { ethers, upgrades } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "POL\n");

  // Deploy KeelToken proxy
  console.log("Deploying KeelToken (UUPS proxy)...");
  const KeelToken = await ethers.getContractFactory("KeelToken");
  const token = await upgrades.deployProxy(KeelToken, [deployer.address], { kind: "uups" });
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log("KeelToken proxy:  ", tokenAddr);

  // Deploy KeelUsageLedger proxy
  console.log("Deploying KeelUsageLedger (UUPS proxy)...");
  const KeelLedger = await ethers.getContractFactory("KeelUsageLedger");
  const ledger = await upgrades.deployProxy(KeelLedger, [deployer.address, tokenAddr], { kind: "uups" });
  await ledger.waitForDeployment();
  const ledgerAddr = await ledger.getAddress();
  console.log("KeelUsageLedger proxy:", ledgerAddr);

  // Grant LEDGER_ROLE to the ledger on the token
  console.log("\nGranting LEDGER_ROLE...");
  const LEDGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("LEDGER_ROLE"));
  await (await token.grantRole(LEDGER_ROLE, ledgerAddr)).wait();
  console.log("LEDGER_ROLE granted.");

  console.log("\n========== DEPLOYMENT COMPLETE ==========");
  console.log("KeelToken (proxy):        ", tokenAddr);
  console.log("KeelUsageLedger (proxy):  ", ledgerAddr);
  console.log("\nThese addresses are PERMANENT. Update index.html:");
  console.log(`  KEEL_TOKEN_ADDRESS  = "${tokenAddr}"`);
  console.log(`  KEEL_LEDGER_ADDRESS = "${ledgerAddr}"`);
  console.log("\nFor future contract changes, run:");
  console.log("  npx hardhat run scripts/upgrade-token.js --network amoy");
  console.log("  npx hardhat run scripts/upgrade-ledger.js --network amoy");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
