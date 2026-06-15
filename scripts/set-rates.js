// scripts/set-rates.js
// Updates pricing on the ALREADY-DEPLOYED KeelUsageLedger (v4, per-slot multipliers).
// Run by the contract admin (DEFAULT_ADMIN_ROLE).
// Usage: npx hardhat run scripts/set-rates.js --network amoy
//
// Pricing model:
//   BASE rateGrid (hundredths of KEEL per hour), evening = half of daytime:
//     period 0 = weekday, period 1 = weekend
//   MULTIPLIERS (basis points, 10000 = 1.00x), per slot (0 = day, 1 = evening):
//     holiday:     day 11500 (1.15x), evening 11000 (1.10x)
//     competitive: day 11000 (1.10x), evening 11000 (1.10x)

const hre = require("hardhat");

async function main() {
  const LEDGER = "0x5c27f0399C3737a68e0933183609b8a273A98eC0"; // ACTIVE v5 ledger proxy

  // --- BASE rates (hundredths of KEEL/hr). period: 0=weekday, 1=weekend ---
  // Halved 2026-06-15: hours charges cut 50% (multipliers unchanged).
  //   weekday day 1.00 / eve 0.50 ; weekend day 2.00 / eve 1.00
  const BASE_RATES = [
    { period: 0, day: 100, evening: 50,  label: "Weekday" },
    { period: 1, day: 200, evening: 100, label: "Weekend" }
  ];

  const [admin] = await hre.ethers.getSigners();
  console.log("Admin:", admin.address);

  const ledger = await hre.ethers.getContractAt("KeelUsageLedger", LEDGER);

  // Base rate grid only — multipliers (holiday/competitive) left untouched.
  for (const r of BASE_RATES) {
    process.stdout.write(`setRate ${r.label}: day=${r.day} evening=${r.evening} ... `);
    const tx = await ledger.setRate(r.period, r.day, r.evening);
    await tx.wait();
    console.log("done");
  }

  // --- Verify on-chain values ---
  console.log("\nVerifying on-chain values:");
  const baseNames = ["Weekday", "Weekend"];
  for (let p = 0; p < 2; p++) {
    const day = await ledger.rateGrid(p, 0);
    const eve = await ledger.rateGrid(p, 1);
    console.log(`  ${baseNames[p]}: day=${day} evening=${eve}`);
  }
  const hd = Number(await ledger.holidayMultiplierBps(0));
  const he = Number(await ledger.holidayMultiplierBps(1));
  const cd = Number(await ledger.competitiveMultiplierBps(0));
  const ce = Number(await ledger.competitiveMultiplierBps(1));
  console.log(`  Holiday mult:     day=${hd} (${(hd/10000).toFixed(2)}x)  evening=${he} (${(he/10000).toFixed(2)}x)`);
  console.log(`  Competitive mult: day=${cd} (${(cd/10000).toFixed(2)}x)  evening=${ce} (${(ce/10000).toFixed(2)}x)`);

  console.log("\n\u2713 Pricing updated. App reads these live, so UI and contract now match.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
