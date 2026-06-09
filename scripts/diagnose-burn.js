const hre = require("hardhat");
async function main() {
  const LEDGER = "0x21bAe325b8EB16250d53AF5C22af5bceab915c3B";
  const provider = hre.ethers.provider;

  // Raw-call quoteHundredths with the FLAT 7-arg signature our app uses.
  const iface = new hre.ethers.Interface([
    "function quoteHundredths(uint32,uint32,uint32,uint32,uint32,uint32,bool) view returns (uint256,uint32)"
  ]);
  const data = iface.encodeFunctionData("quoteHundredths",[60,0,0,0,0,0,false]);
  console.log("selector being called:", data.slice(0,10));
  try {
    const raw = await provider.call({ to: LEDGER, data });
    console.log("RAW RESULT:", raw);
    const decoded = iface.decodeFunctionResult("quoteHundredths", raw);
    console.log("decoded:", decoded.map(String));
  } catch(e) {
    console.log("FAILED with flat signature:", e.shortMessage || e.message);
  }

  // Also dump the deployed bytecode size so we know SOMETHING is there.
  const code = await provider.getCode(LEDGER);
  console.log("bytecode length:", code.length);
}
main().catch(e => console.error("script error:", e.message));