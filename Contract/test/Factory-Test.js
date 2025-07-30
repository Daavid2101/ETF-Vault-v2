// test/VaultFactory.test.js

const { expect } = require("chai");
const { ethers, network } = require("hardhat");

// Trage hier deine Factory-Adresse auf Base ein:
const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS
console.log(FACTORY_ADDRESS)

describe("VaultFactory – On-chain Tests auf Base (Direct Storage Read)", function () {
  let factory;
  let provider;

  before(async function () {
    console.log("Running tests on network:", network.name);
    console.log("ethers version:", ethers.version); // Zum Debuggen der Version
    if (!FACTORY_ADDRESS) {
      throw new Error("FACTORY_ADDRESS is not set!");
    }
    provider = ethers.provider;
    factory = await ethers.getContractAt("VaultFactory", FACTORY_ADDRESS);
  });

  it("liest alle Vaults direkt aus dem contract storage", async function () {
    // Länge des Arrays aus Storage-Slot 1 auslesen (vaults ist zweite Variable)
    const slot = 0; // Korrigiert: Slot 0 ist owner, Slot 1 ist vaults.length
    const lengthHex = await provider.getStorage(FACTORY_ADDRESS, slot);
    const vaultsLengthBigInt = BigInt(lengthHex); // Korrigiert für ethers v6: Native BigInt
    const vaultsLength = Number(vaultsLengthBigInt); // Für kleine Längen sicher als Number
    console.log("Anzahl der Vaults:", vaultsLength);

    // Alle Vaults in einer Schleife auslesen (nutzt public Getter vaults(index))
    if (vaultsLength > 0) {
      for (let i = 0; i < vaultsLength; i++) {
        const vault = await factory.vaults(i);
        console.log(`Vault ${i}:`, vault);
      }
    } else {
      console.log("Keine Vaults vorhanden.");
    }
  });

  it("liest tokens, percentages, isRebalancer und Balances von vault(0)", async function () {
    // Schritt 1: Adresse von vault(0) auslesen
    let vaultAddress;
    try {
      vaultAddress = await factory.vaults(0);
      console.log("Vault(0) Adresse:", vaultAddress);
    } catch (error) {
      console.error("Fehler beim Auslesen von vault(0):", error);
      throw new Error("Vault(0) existiert nicht oder ist nicht zugänglich.");
    }

    // Schritt 2: Instanz von ETFVaultV2 erstellen
    const vault = await ethers.getContractAt("ETFVaultV2", vaultAddress);

    // Schritt 3: tokens-Array und Länge via getTokens() auslesen
    let tokens;
    let tokenLength;
    try {
      tokens = await vault.getTokens();
      tokenLength = tokens.length;
      console.log("Anzahl der Tokens (via getTokens):", tokenLength);
      tokenss = []
      // Token-Symbole und Dezimalstellen auslesen
      for (let i = 0; i < tokenLength; i++) {
        try {
          // Verwende ERC20-Schnittstelle für symbol() und decimals()
          const tokenContract = await ethers.getContractAt("ERC20", tokens[i]);
          const symbol = await tokenContract.symbol();
          const decimals = await tokenContract.decimals();
          tokenss[i] = { address: tokens[i], symbol, decimals };
        } catch (error) {
          console.warn(`Fehler beim Auslesen von symbol/decimals für Token ${i} (${tokens[i]}):`, error);
          // Fallback auf manuelle Zuordnung
          tokenss[i] = TOKEN_INFO[tokens[i]] || { address: tokens[i], symbol: `Token${i}`, decimals: 18 };
        }
      }
      console.log("Tokens:", tokenss);
    } catch (error) {
      console.error("Fehler beim Auslesen von getTokens():", error);
      throw error;
    }

    // Schritt 4: percentages-Array via getAllocations() auslesen
    let percentages;
    try {
      percentages = await vault.getAllocations();
      percentages = percentages.map(p => Number(p)); // Prozentsätze als Number
      console.log("Percentages:", percentages);
    } catch (error) {
      console.error("Fehler beim Auslesen von getAllocations():", error);
      throw error;
    }

    // Schritt 5: isRebalancer für den Vault-Owner prüfen
    let isRebalancer;
    try {
      const owner = await vault.owner();
      isRebalancer = await vault.isRebalancer(owner);
      console.log(`isRebalancer(owner):`, isRebalancer);
      isRebalancer = await vault.isRebalancer("0x42e28fdd077c3f38Beec35b2d54f2a3cDc5d58DD");
      console.log(`isRebalancer(${"0x42e28fdd077c3f38Beec35b2d54f2a3cDc5d58DD"}):`, isRebalancer);
    } catch (error) {
      console.error("Fehler beim Auslesen von isRebalancer:", error);
      throw error;
    }

    // Schritt 6: holdings()-Funktion auslesen
    try {
      const [usdcBal, tokenBals] = await vault.holdings();
      console.log("USDC-Balance (raw):", usdcBal.toString());
      console.log("Token-Balances (raw):", tokenBals.map(bal => bal.toString()));

      // USDC-Balance formatieren (6 Dezimalstellen)
      const usdcDecimals = 6;
      const formattedUsdcBal = ethers.formatUnits(usdcBal, usdcDecimals);
      console.log("USDC-Balance (formatiert):", formattedUsdcBal, "USDC");

      // Token-Balances formatieren
      const formattedTokenBals = tokenBals.map((bal, index) => ({
        token: tokens[index]?.symbol || `Token${index}`,
        address: tokens[index]?.address || "Unknown",
        balance: ethers.formatUnits(bal, tokens[index]?.decimals || 18),
      }));
      console.log("Token-Balances (formatiert):", formattedTokenBals);
    } catch (error) {
      console.error("Fehler beim Auslesen der holdings():", error);
      throw error;
    }

    // Schritt 7: Debugging – Storage-Slot 9 direkt prüfen
    try {
      const tokenSlot = 9; // Länge von tokens sollte in Slot 9 liegen
      const tokenLengthHex = await provider.getStorage(vaultAddress, tokenSlot);
      console.log("Roh-Hex-Wert der Token-Länge (Slot 9):", tokenLengthHex);
      const storageTokenLength = Number(BigInt(tokenLengthHex));
      console.log("Anzahl der Tokens (aus Storage):", storageTokenLength);
      if (storageTokenLength !== tokenLength) {
        console.warn("Warnung: Storage-Länge unterscheidet sich von getTokens()-Länge!");
      }
    } catch (error) {
      console.error("Fehler beim Auslesen von Storage-Slot 9:", error);
    }
  });
});