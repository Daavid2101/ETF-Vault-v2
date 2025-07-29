// scripts/deploy-vault.js
const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // Uniswap v3 SwapRouter02 auf Base Mainnet
  const ROUTER = "0x2626664c2603336E57B271c5C0b26F421741e481"; // ﻿:contentReference[oaicite:0]{index=0}

  const Vault = await ethers.getContractFactory("ETFVault");
  const vault = await Vault.deploy(ROUTER);
  await vault.waitForDeployment();        // ethers v6 API

  console.log("ETFVault deployed →", await vault.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
