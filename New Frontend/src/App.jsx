import { useState, useEffect } from 'react';
import { useAccount, useReadContracts, usePublicClient, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { hexToBigInt, formatUnits, parseUnits } from 'viem';

const FACTORY_ADDRESS = import.meta.env.VITE_FACTORY_ADDRESS;

const FACTORY_ABI = [
  {
    "name": "vaults",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "index",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "type": "address"
      }
    ]
  },
  {
    "name": "createVault",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "_tokenNames",
        "type": "string[]"
      },
      {
        "name": "_percentages",
        "type": "uint256[]"
      },
      {
        "name": "_name",
        "type": "string"
      },
      {
        "name": "_symbol",
        "type": "string"
      }
    ],
    "outputs": [
      {
        "type": "address"
      }
    ]
  }
];

const VAULT_ABI = [
  {
    "name": "getTokens",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "address[]"
      }
    ]
  },
  {
    "name": "getAllocations",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "uint256[]"
      }
    ]
  },
  {
    "name": "holdings",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "uint256"
      },
      {
        "type": "uint256[]"
      }
    ]
  },
  {
    "name": "deposit",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "amountIn",
        "type": "uint256"
      },
      {
        "name": "poolFees",
        "type": "uint24[]"
      },
      {
        "name": "minOuts",
        "type": "uint256[]"
      }
    ],
    "outputs": []
  },
  {
    "name": "withdraw",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "shares",
        "type": "uint256"
      }
    ],
    "outputs": []
  },
  {
    "name": "withdrawUSDC",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "shares",
        "type": "uint256"
      },
      {
        "name": "poolFees",
        "type": "uint24[]"
      },
      {
        "name": "minOuts",
        "type": "uint256[]"
      }
    ],
    "outputs": []
  },
  {
    "name": "isRebalancer",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "type": "bool"
      }
    ]
  },
  {
    "name": "rebalance",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "newTokenNames",
        "type": "string[]"
      },
      {
        "name": "newPercentages",
        "type": "uint256[]"
      },
      {
        "name": "poolFeesToUSDC",
        "type": "uint24[]"
      },
      {
        "name": "minOutsToUSDC",
        "type": "uint256[]"
      },
      {
        "name": "poolFeesFromUSDC",
        "type": "uint24[]"
      },
      {
        "name": "minOutsFromUSDC",
        "type": "uint256[]"
      }
    ],
    "outputs": []
  },
  {
    "name": "totalAssets",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "uint256"
      }
    ]
  },
  {
    "name": "totalSupply",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "uint256"
      }
    ]
  }
];

const ERC20_ABI = [
  {
    "name": "symbol",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "string"
      }
    ]
  },
  {
    "name": "decimals",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "uint8"
      }
    ]
  },
  {
    "name": "approve",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "spender",
        "type": "address"
      },
      {
        "name": "amount",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "type": "bool"
      }
    ]
  },
  {
    "name": "balanceOf",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "type": "uint256"
      }
    ]
  }
];

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_SYMBOL = "USDC";
const USDC_DECIMALS = 6;
const SHARES_DECIMALS = 18;

const TOKEN_OPTIONS = ['WETH', 'cbBTC', 'cbXRP'];

const TOKEN_INFO = {
  "0x4200000000000000000000000000000000000006": { symbol: "WETH", decimals: 18 },
  "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf": { symbol: "cbBTC", decimals: 18 },
  "0xcb585250f852C6c6bf90434AB21A00f02833a4af": { symbol: "cbXRP", decimals: 6 },
};

const App = () => {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [vaultLength, setVaultLength] = useState(0);
  const [vaults, setVaults] = useState([]);
  const [allTokens, setAllTokens] = useState([]);
  const [vaultDetails, setVaultDetails] = useState([]);
  const [userInvestments, setUserInvestments] = useState([]);
  const [error, setError] = useState(null);
  const [depositAmounts, setDepositAmounts] = useState({});
  const [withdrawAmounts, setWithdrawAmounts] = useState({});
  const [txHash, setTxHash] = useState(null);
  const { data: txReceipt } = useWaitForTransactionReceipt({ hash: txHash });
  const [tokenDetailsMap, setTokenDetailsMap] = useState({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [vaultName, setVaultName] = useState('');
  const [vaultSymbol, setVaultSymbol] = useState('');
  const [selectedToken, setSelectedToken] = useState(TOKEN_OPTIONS[0]);
  const [tokenPercent, setTokenPercent] = useState('');
  const [selectedAllocations, setSelectedAllocations] = useState([]);
  const [rebalanceAllocations, setRebalanceAllocations] = useState({});
  const [selectedRebalanceTokens, setSelectedRebalanceTokens] = useState({});
  const [rebalanceTokenPercents, setRebalanceTokenPercents] = useState({});

  useEffect(() => {
    if (!FACTORY_ADDRESS) {
      setError('FACTORY_ADDRESS not set in .env. Please set VITE_FACTORY_ADDRESS=0xYourAddress in .env file and restart the app.');
      return;
    }
    console.log('FACTORY_ADDRESS:', FACTORY_ADDRESS);
  }, []);

  // Read vault length from storage slot 0
  const fetchVaultLength = async () => {
    try {
      const slot = 0n; // Slot 0 for vaults.length
      const lengthHex = await publicClient.getStorageAt({
        address: FACTORY_ADDRESS,
        slot: `0x${slot.toString(16).padStart(64, '0')}`,
      });
      const lengthBigInt = hexToBigInt(lengthHex);
      const length = Number(lengthBigInt);
      setVaultLength(length);
    } catch (err) {
      console.error('Error reading vault length:', err);
      setError('Fehler beim Auslesen der Vault-Länge.');
    }
  };

  useEffect(() => {
    if (isConnected && publicClient && FACTORY_ADDRESS) {
      fetchVaultLength();
    }
  }, [isConnected, publicClient, refreshKey]);

  // Batch read vault addresses
  const vaultContracts = Array.from({ length: vaultLength }, (_, i) => ({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: 'vaults',
    args: [BigInt(i)],
  }));

  const { data: vaultsData } = useReadContracts({
    contracts: vaultContracts,
    query: { enabled: vaultLength > 0 && !!FACTORY_ADDRESS },
  });

  useEffect(() => {
    if (vaultsData) {
      const newVaults = vaultsData.map((item) => item.result).filter((v) => v);
      setVaults(newVaults);
      console.log('Fetched vaults:', newVaults);
    }
  }, [vaultsData]);

  // Batch read vault data (getTokens, getAllocations, holdings, isRebalancer, totalAssets, totalSupply) for each vault
  const vaultDataContracts = vaults.flatMap((vaultAddr) => [
    {
      address: vaultAddr,
      abi: VAULT_ABI,
      functionName: 'getTokens',
    },
    {
      address: vaultAddr,
      abi: VAULT_ABI,
      functionName: 'getAllocations',
    },
    {
      address: vaultAddr,
      abi: VAULT_ABI,
      functionName: 'holdings',
    },
    {
      address: vaultAddr,
      abi: VAULT_ABI,
      functionName: 'isRebalancer',
      args: [address],
    },
    {
      address: vaultAddr,
      abi: VAULT_ABI,
      functionName: 'totalAssets',
    },
    {
      address: vaultAddr,
      abi: VAULT_ABI,
      functionName: 'totalSupply',
    },
  ]);

  const { data: vaultData } = useReadContracts({
    contracts: vaultDataContracts,
    query: { enabled: vaults.length > 0 },
  });

  useEffect(() => {
    if (vaultData) {
      const tokenSet = new Set();
      const tempDetails = [];
      for (let v = 0; v < vaults.length; v++) {
        const baseIndex = v * 6;
        const tokens = vaultData[baseIndex].result || [];
        const percentages = (vaultData[baseIndex + 1].result || []).map(Number);
        const [usdcBal, tokenBals] = vaultData[baseIndex + 2].result || [0n, []];
        const isRebalancer = vaultData[baseIndex + 3].result || false;
        const totalAssets = vaultData[baseIndex + 4].result || 0n;
        const totalSupply = vaultData[baseIndex + 5].result || 0n;

        tokens.forEach(token => tokenSet.add(token));

        tempDetails[v] = {
          address: vaults[v],
          tokens,
          percentages,
          usdcBal,
          tokenBals,
          isRebalancer,
          totalAssets,
          totalSupply,
        };
      }
      setAllTokens(Array.from(tokenSet));
      setVaultDetails(tempDetails);
    }
  }, [vaultData, vaults, address]);

  // Batch read symbol and decimals for all unique tokens
  const tokenDataContracts = allTokens.flatMap((tokenAddr) => [
    {
      address: tokenAddr,
      abi: ERC20_ABI,
      functionName: 'symbol',
    },
    {
      address: tokenAddr,
      abi: ERC20_ABI,
      functionName: 'decimals',
    },
  ]);

  const { data: tokenData } = useReadContracts({
    contracts: tokenDataContracts,
    query: { enabled: allTokens.length > 0 },
  });

  useEffect(() => {
    if (tokenData) {
      const tempTokenDetailsMap = {};
      for (let t = 0; t < allTokens.length; t++) {
        const baseIndex = t * 2;
        const symbol = tokenData[baseIndex].result || TOKEN_INFO[allTokens[t]]?.symbol || 'Unknown';
        const decimals = Number(tokenData[baseIndex + 1].result) || TOKEN_INFO[allTokens[t]]?.decimals || 18;
        tempTokenDetailsMap[allTokens[t]] = { symbol, decimals };
      }
      setTokenDetailsMap(tempTokenDetailsMap);

      // Update vaultDetails with formatted balances and allocations
      const updatedDetails = vaultDetails.map((detail) => {
        const formattedUsdc = formatUnits(detail.usdcBal, USDC_DECIMALS);
        const formattedTokens = detail.tokenBals.map((bal, index) => {
          const tokenAddr = detail.tokens[index];
          const { symbol, decimals } = tempTokenDetailsMap[tokenAddr] || { symbol: 'Unknown', decimals: 18 };
          return { symbol, balance: formatUnits(bal, decimals) };
        });
        const formattedAllocations = detail.percentages.map((perc, index) => {
          const tokenAddr = detail.tokens[index];
          const { symbol } = tempTokenDetailsMap[tokenAddr] || { symbol: 'Unknown' };
          return `${symbol}: ${perc}%`;
        });
        const formattedTotalValue = formatUnits(detail.totalAssets, USDC_DECIMALS);
        let navPerShare = '0';
        if (detail.totalSupply > 0n) {
          navPerShare = formatUnits((detail.totalAssets * 10n ** 18n) / detail.totalSupply, USDC_DECIMALS);
        }
        return { ...detail, formattedUsdc, formattedTokens, formattedAllocations, formattedTotalValue, navPerShare };
      });
      setVaultDetails(updatedDetails);
    }
  }, [tokenData, allTokens, vaultDetails]);

  // Batch read user balances, symbols, and decimals for each vault
  const investmentContracts = vaults.flatMap((vaultAddr) => [
    {
      address: vaultAddr,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [address],
    },
    {
      address: vaultAddr,
      abi: ERC20_ABI,
      functionName: 'symbol',
    },
    {
      address: vaultAddr,
      abi: ERC20_ABI,
      functionName: 'decimals',
    },
  ]);

  const { data: investmentData } = useReadContracts({
    contracts: investmentContracts,
    query: { enabled: vaults.length > 0 && isConnected && address },
  });

  useEffect(() => {
    if (investmentData) {
      const newInvestments = [];
      for (let v = 0; v < vaults.length; v++) {
        const baseIndex = v * 3;
        const balance = investmentData[baseIndex].result || 0n;
        const symbol = investmentData[baseIndex + 1].result || 'Unknown';
        const decimals = Number(investmentData[baseIndex + 2].result) || 18;
        const formattedBalance = formatUnits(balance, decimals);
        if (balance > 0n) {
          newInvestments.push({
            address: vaults[v],
            symbol,
            balance: formattedBalance,
          });
        }
      }
      setUserInvestments(newInvestments);
    }
  }, [investmentData, vaults, address]);

  // Functions for approve, deposit, withdraw, withdrawUSDC
  const { writeContract, data: writeHash } = useWriteContract();

  useEffect(() => {
    if (writeHash) {
      setTxHash(writeHash);
    }
  }, [writeHash]);

  useEffect(() => {
    if (txReceipt && txReceipt.status === 'success') {
      setRefreshKey((k) => k + 1);
    }
  }, [txReceipt]);

  const handleApprove = (vaultAddr, amountIn) => {
    const scaledAmountIn = parseUnits(amountIn || '0', USDC_DECIMALS);
    writeContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [vaultAddr, scaledAmountIn],
    });
  };

  const handleDeposit = (vaultAddr, amountIn, tokenLength) => {
    const scaledAmountIn = parseUnits(amountIn || '0', USDC_DECIMALS);
    const poolFees = Array(tokenLength).fill(500n);
    const minOuts = Array(tokenLength).fill(0n);
    writeContract({
      address: vaultAddr,
      abi: VAULT_ABI,
      functionName: 'deposit',
      args: [scaledAmountIn, poolFees, minOuts],
    });
  };

  const handleWithdraw = (vaultAddr, shares) => {
    const scaledShares = parseUnits(shares || '0', SHARES_DECIMALS);
    writeContract({
      address: vaultAddr,
      abi: VAULT_ABI,
      functionName: 'withdraw',
      args: [scaledShares],
    });
  };

  const handleWithdrawUSDC = (vaultAddr, shares, tokenLength) => {
    const scaledShares = parseUnits(shares || '0', SHARES_DECIMALS);
    const poolFees = Array(tokenLength).fill(500n);
    const minOuts = Array(tokenLength).fill(0n);
    writeContract({
      address: vaultAddr,
      abi: VAULT_ABI,
      functionName: 'withdrawUSDC',
      args: [scaledShares, poolFees, minOuts],
    });
  };

  const handleAddAllocation = () => {
    if (tokenPercent && !selectedAllocations.some(alloc => alloc.token === selectedToken)) {
      setSelectedAllocations([...selectedAllocations, { token: selectedToken, percent: tokenPercent }]);
      setTokenPercent('');
    }
  };

  const handleRemoveAllocation = (token) => {
    setSelectedAllocations(selectedAllocations.filter(alloc => alloc.token !== token));
  };

  const handleCreate = () => {
    const tokenNames = selectedAllocations.map(alloc => alloc.token);
    const percentages = selectedAllocations.map(alloc => BigInt(alloc.percent));
    writeContract({
      address: FACTORY_ADDRESS,
      abi: FACTORY_ABI,
      functionName: 'createVault',
      args: [tokenNames, percentages, vaultName, vaultSymbol],
    });
    // Reset form after creation
    setSelectedAllocations([]);
    setVaultName('');
    setVaultSymbol('');
  };

  const handleAddRebalanceAllocation = (index) => {
    const percent = rebalanceTokenPercents[index] || '';
    const token = selectedRebalanceTokens[index] || TOKEN_OPTIONS[0];
    const allocs = rebalanceAllocations[index] || [];
    if (percent && !allocs.some(alloc => alloc.token === token)) {
      setRebalanceAllocations({
        ...rebalanceAllocations,
        [index]: [...allocs, { token, percent }]
      });
      setRebalanceTokenPercents({
        ...rebalanceTokenPercents,
        [index]: ''
      });
    }
  };

  const handleRemoveRebalanceAllocation = (index, token) => {
    const allocs = rebalanceAllocations[index] || [];
    setRebalanceAllocations({
      ...rebalanceAllocations,
      [index]: allocs.filter(alloc => alloc.token !== token)
    });
  };

  const handleRebalance = (index, vaultAddr, currentTokenLength) => {
    const allocs = rebalanceAllocations[index] || [];
    const newTokenNames = allocs.map(alloc => alloc.token);
    const newPercentages = allocs.map(alloc => BigInt(alloc.percent));
    const poolFeesToUSDC = Array(currentTokenLength).fill(500n);
    const minOutsToUSDC = Array(currentTokenLength).fill(0n);
    const poolFeesFromUSDC = Array(newTokenNames.length).fill(500n);
    const minOutsFromUSDC = Array(newTokenNames.length).fill(0n);
    writeContract({
      address: vaultAddr,
      abi: VAULT_ABI,
      functionName: 'rebalance',
      args: [newTokenNames, newPercentages, poolFeesToUSDC, minOutsToUSDC, poolFeesFromUSDC, minOutsFromUSDC],
    });
    // Reset after rebalance
    setRebalanceAllocations({
      ...rebalanceAllocations,
      [index]: []
    });
  };

  const handleInputChange = (type, index, value) => {
    if (type === 'deposit') {
      setDepositAmounts((prev) => ({ ...prev, [index]: value }));
    } else if (type === 'withdraw') {
      setWithdrawAmounts((prev) => ({ ...prev, [index]: value }));
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h1>Vaults Dashboard</h1>
      <ConnectButton />
      {error ? (
        <p style={{ color: 'red' }}>{error}</p>
      ) : isConnected ? (
        <div>
          <p>Connected as: {address}</p>
          <h2>Create New Vault</h2>
          <input
            type="text"
            placeholder="Vault Name"
            value={vaultName}
            onChange={(e) => setVaultName(e.target.value)}
          />
          <input
            type="text"
            placeholder="Vault Symbol"
            value={vaultSymbol}
            onChange={(e) => setVaultSymbol(e.target.value)}
          />
          <h3>Add Allocations</h3>
          <select value={selectedToken} onChange={(e) => setSelectedToken(e.target.value)}>
            {TOKEN_OPTIONS.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <input
            type="number"
            placeholder="Percent"
            value={tokenPercent}
            onChange={(e) => setTokenPercent(e.target.value)}
          />
          <button onClick={handleAddAllocation}>Add Token</button>
          <ul>
            {selectedAllocations.map((alloc, idx) => (
              <li key={idx}>
                {alloc.token}: {alloc.percent}% 
                <button onClick={() => handleRemoveAllocation(alloc.token)}>Remove</button>
              </li>
            ))}
          </ul>
          <button onClick={handleCreate} disabled={selectedAllocations.length === 0}>Create Vault</button>
          <p>Anzahl der Vaults: {vaultLength}</p>
          {vaultLength > 0 ? (
            <ul>
              {vaultDetails.map((detail, index) => {
                const ourInv = userInvestments.find(inv => inv.address === detail.address);
                const positionValue = ourInv ? (parseFloat(ourInv.balance) * parseFloat(detail.navPerShare)).toFixed(2) : '0';
                return (
                <li key={index}>
                  Vault {index}: {detail.address}
                  <ul>
                    <li>Allocations: {detail.formattedAllocations?.join(', ') || 'None'}</li>
                    <li>Total Value: {detail.formattedTotalValue} USDC</li>
                    <li>NAV per Share: {detail.navPerShare} USDC</li>
                    <li>{USDC_SYMBOL}: {detail.formattedUsdc || '0'}</li>
                    {detail.formattedTokens?.map((token, tIndex) => (
                      <li key={tIndex}>{token.symbol}: {token.balance}</li>
                    ))}
                    <li>
                      Your Shares: {ourInv?.balance || '0'} {ourInv?.symbol || 'Unknown'}
                    </li>
                    <li>Your Position Value: {positionValue} USDC</li>
                  </ul>
                  <input
                    type="number"
                    placeholder="USDC Amount to Deposit"
                    onChange={(e) => handleInputChange('deposit', index, e.target.value)}
                  />
                  <button onClick={() => handleApprove(vaults[index], depositAmounts[index] || '0')}>Approve USDC</button>
                  <button onClick={() => handleDeposit(vaults[index], depositAmounts[index] || '0', detail.tokens.length)}>Invest</button>
                  <input
                    type="number"
                    placeholder="Shares to Withdraw"
                    onChange={(e) => handleInputChange('withdraw', index, e.target.value)}
                  />
                  <button onClick={() => handleWithdraw(vaults[index], withdrawAmounts[index] || '0')}>Withdraw Pro-Rata</button>
                  <button onClick={() => handleWithdrawUSDC(vaults[index], withdrawAmounts[index] || '0', detail.tokens.length)}>Withdraw USDC</button>
                  {detail.isRebalancer && (
                    <div>
                      <h3>Rebalance this Vault</h3>
                      <select
                        value={selectedRebalanceTokens[index] || TOKEN_OPTIONS[0]}
                        onChange={(e) => setSelectedRebalanceTokens({...selectedRebalanceTokens, [index]: e.target.value})}
                      >
                        {TOKEN_OPTIONS.map(option => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        placeholder="Percent"
                        value={rebalanceTokenPercents[index] || ''}
                        onChange={(e) => setRebalanceTokenPercents({...rebalanceTokenPercents, [index]: e.target.value})}
                      />
                      <button onClick={() => handleAddRebalanceAllocation(index)}>Add Token</button>
                      <ul>
                        {(rebalanceAllocations[index] || []).map((alloc, idx) => (
                          <li key={idx}>
                            {alloc.token}: {alloc.percent}% 
                            <button onClick={() => handleRemoveRebalanceAllocation(index, alloc.token)}>Remove</button>
                          </li>
                        ))}
                      </ul>
                      <button onClick={() => handleRebalance(index, vaults[index], detail.tokens.length)} disabled={(rebalanceAllocations[index] || []).length === 0}>Rebalance</button>
                    </div>
                  )}
                </li>
                );
              })}
            </ul>
          ) : (
            <p>Keine Vaults vorhanden.</p>
          )}
          <h2>Deine Investments</h2>
          {userInvestments.length > 0 ? (
            <ul>
              {userInvestments.map((inv, index) => (
                <li key={index}>
                  Vault: {inv.address} - {inv.balance} {inv.symbol}
                </li>
              ))}
            </ul>
          ) : (
            <p>Du bist in keinen Vault investiert.</p>
          )}
        </div>
      ) : (
        <p>Bitte verbinde deine Wallet mit MetaMask.</p>
      )}
    </div>
  );
};

export default App;