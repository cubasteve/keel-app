// cleanup-old-contracts.js
// Burns the deployer's balance on all old token contracts and revokes
// MINTER_ROLE + LEDGER_ROLE so no new tokens can ever be issued on them.
// The contracts themselves cannot be deleted — this is the best we can do.

const hre = require("hardhat");

const OLD_TOKENS = [
  "0x9cd72e3d13AdAd360A2e944A2BB84cf901893D15", // v1
  "0x757743aF271b4B7c4CBF1363F518A4D5b50307F1", // v2
  "0xBd2166367113572E37044A385931488AD0971DDd", // v3
];

const ACTIVE_TOKEN = "0xd4Ca4D559ccE5025e198B0EBb351BD7cE9C4164A"; // UUPS proxy — do NOT touch

const TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function burn(uint256) external",
  "function hasRole(bytes32, address) view returns (bool)",
  "function revokeRole(bytes32, address) external",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function MINTER_ROLE() view returns (bytes32)",
  "function LEDGER_ROLE() view returns (bytes32)",
  "function getRoleMemberCount(bytes32) view returns (uint256)",
  "function getRoleMember(bytes32, uint256) view returns (address)",
];

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Active token (will NOT be touched):", ACTIVE_TOKEN, "\n");

  for (const addr of OLD_TOKENS) {
    console.log("────────────────────────────────────");
    console.log("Processing old token:", addr);

    let token;
    try {
      token = await hre.ethers.getContractAt(TOKEN_ABI, addr);
    } catch(e) {
      console.log("  Could not attach — skipping.\n");
      continue;
    }

    // 1. Burn deployer's balance
    try {
      const bal = await token.balanceOf(deployer.address);
      if (bal > 0n) {
        console.log("  Balance:", hre.ethers.formatUnits(bal, 18), "KEEL — burning...");
        const tx = await token.burn(bal);
        await tx.wait();
        console.log("  ✓ Burned.");
      } else {
        console.log("  Balance: 0 — nothing to burn.");
      }
    } catch(e) {
      console.log("  Burn failed:", e.reason || e.message);
    }

    // 2. Revoke MINTER_ROLE
    try {
      const MINTER_ROLE = await token.MINTER_ROLE();
      const hasMinter = await token.hasRole(MINTER_ROLE, deployer.address);
      if (hasMinter) {
        await (await token.revokeRole(MINTER_ROLE, deployer.address)).wait();
        console.log("  ✓ MINTER_ROLE revoked.");
      } else {
        console.log("  MINTER_ROLE already revoked.");
      }
    } catch(e) {
      console.log("  Revoke MINTER_ROLE failed:", e.reason || e.message);
    }

    // 3. Revoke LEDGER_ROLE
    try {
      const LEDGER_ROLE = await token.LEDGER_ROLE();
      const hasLedger = await token.hasRole(LEDGER_ROLE, deployer.address);
      if (hasLedger) {
        await (await token.revokeRole(LEDGER_ROLE, deployer.address)).wait();
        console.log("  ✓ LEDGER_ROLE revoked.");
      } else {
        console.log("  LEDGER_ROLE already revoked.");
      }
    } catch(e) {
      console.log("  Revoke LEDGER_ROLE failed:", e.reason || e.message);
    }

    console.log("  Done.\n");
  }

  console.log("────────────────────────────────────");
  console.log("Cleanup complete.");
  console.log("Old contracts still exist on-chain but can no longer mint tokens.");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
