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
  const LEDGER = "0x6E26D169340dC846faeeAf78d5ef11584e3492Db";

  // --- BASE rates (hundredths of KEEL/hr). period: 0=weekday, 1=weekend ---
  const BASE_RATES = [
    { period: 0, day: 200, evening: 100, label: "Weekday" },
    { period: 1, day: 400, evening: 200, label: "Weekend" }
  ];

  // --- Per-slot multipliers (basis points). slot: 0=day, 1=evening ---
  const HOLIDAY_MULT     = [ { slot: 0, bps: 11500 }, { slot: 1, bps: 11000 } ]; // 1.15x / 1.10x
  const COMPETITIVE_MULT = [ { slot: 0, bps: 11000 }, { slot: 1, bps: 11000 } ]; // 1.10x / 1.10x

  const [admin] = await hre.ethers.getSigners();
  console.log("Admin:", admin.address);

  const ledger = await hre.ethers.getContractAt("KeelUsageLedger", LEDGER);

  // 1) Base rate grid
  for (const r of BASE_RATES) {
    process.stdout.write(`setRate ${r.label}: day=${r.day} evening=${r.evening} ... `);
    const tx = await ledger.setRate(r.period, r.day, r.evening);
    await tx.wait();
    console.log("done");
  }

  // 2) Holiday multipliers (per slot)
  for (const m of HOLIDAY_MULT) {
    const slotName = m.slot === 0 ? "day" : "evening";
    process.stdout.write(`setHolidayMultiplier ${slotName}: ${m.bps} bps (${(m.bps/10000).toFixed(2)}x) ... `);
    const tx = await ledger.setHolidayMultiplier(m.slot, m.bps);
    await tx.wait();
    console.log("done");
  }

  // 3) Competitive multipliers (per slot)
  for (const m of COMPETITIVE_MULT) {
    const slotName = m.slot === 0 ? "day" : "evening";
    process.stdout.write(`setCompetitiveMultiplier ${slotName}: ${m.bps} bps (${(m.bps/10000).toFixed(2)}x) ... `);
    const tx = await ledger.setCompetitiveMultiplier(m.slot, m.bps);
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
  const hd = await ledger.holidayMultiplierBps(0);
  const he = await ledger.holidayMultiplierBps(1);
  const cd = await ledger.competitiveMultiplierBps(0);
  const ce = await ledger.competitiveMultiplierBps(1);
  console.log(`  Holiday mult:     day=${hd} (${(hd/10000).toFixed(2)}x)  evening=${he} (${(he/10000).toFixed(2)}x)`);
  console.log(`  Competitive mult: day=${cd} (${(cd/10000).toFixed(2)}x)  evening=${ce} (${(ce/10000).toFixed(2)}x)`);

  console.log("\n\u2713 Pricing updated. App reads these live, so UI and contract now match.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
