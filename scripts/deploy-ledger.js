// scripts/deploy-ledger.js
// npx hardhat run scripts/deploy-ledger.js --network amoy

const hre = require("hardhat");

async function main() {
  const KEEL_TOKEN = "0x9cd72e3d13AdAd360A2e944A2BB84cf901893D15";
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const Ledger = await hre.ethers.getContractFactory("KeelUsageLedger");
  const ledger = await Ledger.deploy(deployer.address, KEEL_TOKEN);
  await ledger.waitForDeployment();

  const addr = await ledger.getAddress();
  console.log("KeelUsageLedger deployed to:", addr);
  console.log("\nNext: run grant-ledger-role.js with this address, then update keel-app.html");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
