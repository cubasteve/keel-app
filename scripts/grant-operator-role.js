// scripts/grant-operator-role.js
// Grants OPERATOR_ROLE on the KeelUsageLedger to the gasless relayer wallet,
// so the relayer can submit logAndSettle / cancelTrip / setMemberProfile on
// behalf of members (members sign off-chain; the relayer pays gas).
//
//   1. Create a fresh wallet in MetaMask for the relayer.
//   2. Put its ADDRESS in RELAYER_ADDRESS below.
//   3. npx hardhat run scripts/grant-operator-role.js --network amoy
//   4. Fund the relayer wallet with POL (Amoy faucet) for gas.
//   5. Put its PRIVATE KEY into the Worker secret: wrangler secret put RELAYER_KEY
//
// Run from the deployer/admin account (it holds DEFAULT_ADMIN_ROLE).

const hre = require("hardhat");

async function main() {
  const LEDGER          = "0x5c27f0399C3737a68e0933183609b8a273A98eC0"; // active v5 ledger proxy
  const RELAYER_ADDRESS = "0x1c13DB2d82da0220594BdBb96D30eF6a4Ba304Ff";

  if (!hre.ethers.isAddress(RELAYER_ADDRESS) || RELAYER_ADDRESS.includes("REPLACE")) {
    throw new Error("Set RELAYER_ADDRESS to your relayer wallet address first.");
  }

  const [admin] = await hre.ethers.getSigners();
  console.log("Granting OPERATOR_ROLE from admin:", admin.address);

  const ledger = await hre.ethers.getContractAt("KeelUsageLedger", LEDGER);
  const OPERATOR_ROLE = await ledger.OPERATOR_ROLE();

  if (await ledger.hasRole(OPERATOR_ROLE, RELAYER_ADDRESS)) {
    console.log("✓ Relayer already has OPERATOR_ROLE — nothing to do.");
    return;
  }

  const tx = await ledger.grantRole(OPERATOR_ROLE, RELAYER_ADDRESS);
  console.log("grantRole tx:", tx.hash);
  await tx.wait();

  const ok = await ledger.hasRole(OPERATOR_ROLE, RELAYER_ADDRESS);
  console.log(ok ? "✓ OPERATOR_ROLE granted to " + RELAYER_ADDRESS : "✗ Grant failed.");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
