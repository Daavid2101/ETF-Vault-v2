// hardhat.config.js
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: "0.8.24",

  networks: {
    // lokales Hardhat-Netz bleibt Default
    base: {
      url: process.env.RPC_URL_BASE || "https://mainnet.base.org", // öffentl. RPC - für Prod besser Provider nutzen
      chainId: 8453,                                               // Base Mainnet :contentReference[oaicite:0]{index=0}
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    }
  },

  etherscan: {
    // Keys können pro Chain hinterlegt werden
    apiKey: {
      base: process.env.BASESCAN_API_KEY || ""
    },
    // Custom-Eintrag, weil Basescan noch kein offizieller Preset ist
    customChains: [
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org"
        }
      }
    ]
  }
};
