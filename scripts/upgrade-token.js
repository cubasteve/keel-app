// upgrade-token.js — upgrades the KeelToken implementation without changing the proxy address.
// The proxy address (and all token balances/state) are preserved.

const { ethers, upgrades } = require("hardhat");

const PROXY = "0xd4Ca4D559ccE5025e198B0EBb351BD7cE9C4164A";

async function main() {
  console.log("Upgrading KeelToken at proxy:", PROXY);
  const KeelToken = await ethers.getContractFactory("KeelToken");
  const token = await upgrades.upgradeProxy(PROXY, KeelToken, { kind: "uups" });
  await token.waitForDeployment();
  console.log("KeelToken upgraded. Proxy address unchanged:", await token.getAddress());
}

main().catch(e => { console.error(e); process.exitCode = 1; });
