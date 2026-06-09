// scripts/diagnose.js
// Surfaces the real reason logAndSettle is reverting.
// Usage: npx hardhat run scripts/diagnose.js --network amoy

const hre = require("hardhat");

async function main() {
  const TOKEN  = "0x9cd72e3d13AdAd360A2e944A2BB84cf901893D15";

  // ── EDIT: the ledger address your APP is pointing at (KEEL_LEDGER_ADDRESS) ──
  const LEDGER = "0x193642251B3430F76c93bcF7D7d92994e4720609";

  const [signer] = await hre.ethers.getSigners();
  const me = signer.address;
  console.log("Wallet:", me);

  const token  = await hre.ethers.getContractAt("KeelToken", TOKEN);
  const ledger = await hre.ethers.getContractAt("KeelUsageLedger", LEDGER);

  // 1) KEEL balance
  const bal = await token.balanceOf(me);
  console.log("KEEL balance:", hre.ethers.formatUnits(bal, 18));

  // 2) Does the ledger hold LEDGER_ROLE on the token?
  const LEDGER_ROLE = await token.LEDGER_ROLE();
  const hasRole = await token.hasRole(LEDGER_ROLE, LEDGER);
  console.log("Ledger has LEDGER_ROLE:", hasRole);

  // 3) Try a quote (pure) then a static call of logAndSettle to get revert reason
  const buckets = {
    weekdayDay: 0, weekdayEvening: 0,
    weekendDay: 60, weekendEvening: 0,   // 6.0h weekend daytime => 24 KEEL
    holidayDay: 0, holidayEvening: 0
  };
  const now = Math.floor(Date.now() / 1000);

  try {
    const [hundredths, tenths] = await ledger.quoteHundredths(buckets, false, false, false);
    console.log("Quote:", Number(hundredths) / 100, "KEEL,", Number(tenths) / 10, "hrs");
  } catch (e) {
    console.log("quoteHundredths failed:", e.shortMessage || e.message);
  }

  try {
    await ledger.logAndSettle.staticCall(me, now, now + 21600, buckets, false, false, false);
    console.log("staticCall succeeded — the call itself is valid.");
  } catch (e) {
    console.log("REVERT REASON:", e.shortMessage || e.reason || e.message);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });