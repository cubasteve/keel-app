const hre = require("hardhat");
async function main() {
  const tx = await hre.ethers.provider.getCode("0x0cfDb80F2171191930c8Ee697DCFe1069BB5D699");
  console.log("contract exists:", tx !== "0x");
  console.log("current block:", await hre.ethers.provider.getBlockNumber());
}
main().catch(e=>console.error(e.message));