// upgrade-ledger.js — upgrades the KeelUsageLedger implementation without changing the proxy address.
// All trip records, member profiles, and reservation state are preserved.

const { ethers, upgrades } = require("hardhat");

const PROXY = "0x5c27f0399C3737a68e0933183609b8a273A98eC0";

async function main() {
  console.log("Upgrading KeelUsageLedger at proxy:", PROXY);
  const KeelLedger = await ethers.getContractFactory("KeelUsageLedger");
  const ledger = await upgrades.upgradeProxy(PROXY, KeelLedger, { kind: "uups" });
  await ledger.waitForDeployment();
  console.log("KeelUsageLedger upgraded. Proxy address unchanged:", await ledger.getAddress());
}

main().catch(e => { console.error(e); process.exitCode = 1; });
