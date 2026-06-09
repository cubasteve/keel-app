const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const KEEL_TOKEN = "0xBd2166367113572E37044A385931488AD0971DDd";
  const RECIPIENT  = deployer.address;
  const AMOUNT     = hre.ethers.parseUnits("100", 18);

  const token = await hre.ethers.getContractAt("KeelToken", KEEL_TOKEN);
  const now   = new Date();
  const tx    = await token.mintMonthlyAllocation(RECIPIENT, AMOUNT, now.getFullYear(), now.getMonth() + 1);
  await tx.wait();

  const bal = await token.balanceOf(RECIPIENT);
  console.log("✓ Minted 100 KEEL to", RECIPIENT);
  console.log("  New balance:", hre.ethers.formatUnits(bal, 18), "KEEL");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
