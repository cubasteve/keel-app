// scripts/check-deployed.js
// Checks whether the new contract's functions actually exist at the address.
// Usage: npx hardhat run scripts/check-deployed.js --network amoy

const hre = require("hardhat");

async function main() {
  // ── EDIT: the same ledger address you put in diagnose.js / the app ──
  const LEDGER = "0x21bAe325b8EB16250d53AF5C22af5bceab915c3B";

  const provider = hre.ethers.provider;

  // 1) Is there even a contract here?
  const code = await provider.getCode(LEDGER);
  if (code === "0x") {
    console.log("NOTHING deployed at this address. Wrong address.");
    return;
  }
  console.log("Bytecode length:", code.length, "(non-empty = a contract exists)");

  // 2) Probe for the NEW function quoteHundredths via its selector.
  //    If the call doesn't revert with 'no function', the new code is there.
  const iface = new hre.ethers.Interface([
    "function quoteHundredths((uint32,uint32,uint32,uint32,uint32,uint32),bool,bool,bool) view returns (uint256,uint32)"
  ]);
  const data = iface.encodeFunctionData("quoteHundredths", [
    [0, 0, 60, 0, 0, 0], false, false, false
  ]);

  try {
    const raw = await provider.call({ to: LEDGER, data });
    const [h, t] = iface.decodeFunctionResult("quoteHundredths", raw);
    console.log("NEW contract IS deployed here. Quote:", Number(h) / 100, "KEEL");
  } catch (e) {
    console.log("NEW function quoteHundredths NOT found at this address.");
    console.log("=> This address holds the OLD ledger (or a different contract).");
  }

  // 3) Probe for an OLD-style function to confirm which one it is.
  const oldIface = new hre.ethers.Interface([
    "function logAndSettle(address,uint256,uint256,bool,bool) returns (bytes32)"
  ]);
  console.log("\nIf NEW was not found, redeploy and use the freshly printed address.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });