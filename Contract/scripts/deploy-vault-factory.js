// scripts/deploy-vault.js
const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const Vault = await ethers.getContractFactory("VaultFactory");
  const vault = await Vault.deploy();
  await vault.waitForDeployment();

  console.log("Vault Factory deployed →", await vault.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
