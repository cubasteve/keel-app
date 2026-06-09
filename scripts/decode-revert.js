const hre = require("hardhat");
async function main() {
  const TX = "0x31d1065c25ab22cb8a93f152b2444ee7335bf29c84fd1783900bf9fb7729c342";
  const tx = await hre.ethers.provider.getTransaction(TX);
  try {
    await hre.ethers.provider.call(tx, tx.blockNumber);
  } catch(e) {
    console.log("Revert reason:", e.shortMessage || e.reason || e.data || e.message);
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });