const hre = require("hardhat");
async function main() {
  const LEDGER = "0x21bAe325b8EB16250d53AF5C22af5bceab915c3B";
  const ME = "0xa953cF5c65EA74c66d874186D3832E398d388660";
  const ledger = await hre.ethers.getContractAt("KeelUsageLedger", LEDGER);
  try {
    await ledger.logAndSettle.staticCall(
      ME, 1780714800, 1780722000,
      [0, 10, 0, 10, 0, 0],
      false, false, false
    );
    console.log("Static call succeeded — transaction should work.");
  } catch(e) {
    console.log("Revert reason:", e.shortMessage || e.reason || e.message);
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });