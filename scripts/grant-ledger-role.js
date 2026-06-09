// scripts/grant-ledger-role.js
// npx hardhat run scripts/grant-ledger-role.js --network amoy

const hre = require("hardhat");

async function main() {
  const KEEL_TOKEN  = "0x9cd72e3d13AdAd360A2e944A2BB84cf901893D15";
  const NEW_LEDGER  = "0x3AE295191F6a5938DA5D893b27e04F3ED75fA867";

  const [admin] = await hre.ethers.getSigners();
  const token = await hre.ethers.getContractAt("KeelToken", KEEL_TOKEN);
  const LEDGER_ROLE = await token.LEDGER_ROLE();

  const tx = await token.grantRole(LEDGER_ROLE, NEW_LEDGER);
  await tx.wait();

  const ok = await token.hasRole(LEDGER_ROLE, NEW_LEDGER);
  console.log(ok ? "✓ LEDGER_ROLE granted." : "✗ Grant failed.");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
