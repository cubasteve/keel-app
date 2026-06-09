// init-tokenomics.js
// One-time: sets walletCap + monthlyAllocation on the existing proxy
// (initialize() only runs on first deploy; upgrades don't re-run it)
const hre = require("hardhat");

const PROXY = "0xd4Ca4D559ccE5025e198B0EBb351BD7cE9C4164A";
const ABI = [
  "function walletCap() view returns (uint256)",
  "function monthlyAllocation() view returns (uint256)",
  "function setWalletCap(uint256) external",
  "function setMonthlyAllocation(uint256) external",
];

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const token = await hre.ethers.getContractAt(ABI, PROXY);

  const wc = await token.walletCap();
  const ma = await token.monthlyAllocation();
  console.log("Current walletCap:        ", hre.ethers.formatUnits(wc, 18), "KEEL");
  console.log("Current monthlyAllocation:", hre.ethers.formatUnits(ma, 18), "KEEL");

  if (wc == 0n) {
    console.log("Setting walletCap to 300 KEEL...");
    await (await token.setWalletCap(hre.ethers.parseUnits("300", 18))).wait();
    console.log("✓ walletCap set.");
  }
  if (ma == 0n) {
    console.log("Setting monthlyAllocation to 100 KEEL...");
    await (await token.setMonthlyAllocation(hre.ethers.parseUnits("100", 18))).wait();
    console.log("✓ monthlyAllocation set.");
  }

  const wc2 = await token.walletCap();
  const ma2 = await token.monthlyAllocation();
  console.log("\nFinal walletCap:        ", hre.ethers.formatUnits(wc2, 18), "KEEL");
  console.log("Final monthlyAllocation:", hre.ethers.formatUnits(ma2, 18), "KEEL");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
