import React, { useState, useEffect, useMemo } from 'react';
import { useAccount, useConnect, useDisconnect, useReadContracts, usePublicClient, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { metaMask } from '@wagmi/connectors';
import { hexToBigInt, formatUnits, parseUnits } from 'viem';
import { Copy, Plus, Minus, TrendingUp, DollarSign, Wallet, Users, Settings, ChevronDown, ChevronUp, LogOut, Check, X, Zap } from 'lucide-react';
import { BrowserProvider, Contract } from 'ethers';

const FACTORY_ADDRESS = import.meta.env.VITE_FACTORY_ADDRESS || '0x1234567890123456789012345678901234567890';

const FACTORY_ABI = [
  {
    "name": "vaults",
    "type": "function",
    "stateMutability": "view",
    "inputs": [{"name": "index", "type": "uint256"}],
    "outputs": [{"type": "address"}]
  },
  {
    "name": "createVault",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {"name": "_tokenNames", "type": "string[]"},
      {"name": "_percentages", "type": "uint256[]"},
      {"name": "_name", "type": "string"},
      {"name": "_symbol", "type": "string"}
    ],
    "outputs": [{"type": "address"}]
  }
];

const VAULT_ABI = [
  {"name": "getTokens", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"type": "address[]"}]},
  {"name": "getAllocations", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"type": "uint256[]"}]},
  {"name": "holdings", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"type": "uint256"}, {"type": "uint256[]"}]},
  {"name": "deposit", "type": "function", "stateMutability": "nonpayable", "inputs": [{"name": "amountIn", "type": "uint256"}, {"name": "poolFees", "type": "uint24[]"}, {"name": "minOuts", "type": "uint256[]"}], "outputs": []},
  {"name": "withdraw", "type": "function", "stateMutability": "nonpayable", "inputs": [{"name": "shares", "type": "uint256"}], "outputs": []},
  {"name": "withdrawUSDC", "type": "function", "stateMutability": "nonpayable", "inputs": [{"name": "shares", "type": "uint256"}, {"name": "poolFees", "type": "uint24[]"}, {"name": "minOuts", "type": "uint256[]"}], "outputs": []},
  {"name": "isRebalancer", "type": "function", "stateMutability": "view", "inputs": [{"name": "account", "type": "address"}], "outputs": [{"type": "bool"}]},
  {"name": "rebalance", "type": "function", "stateMutability": "nonpayable", "inputs": [{"name": "newTokenNames", "type": "string[]"}, {"name": "newPercentages", "type": "uint256[]"}, {"name": "poolFeesToUSDC", "type": "uint24[]"}, {"name": "minOutsToUSDC", "type": "uint256[]"}, {"name": "poolFeesFromUSDC", "type": "uint24[]"}, {"name": "minOutsFromUSDC", "type": "uint256[]"}], "outputs": []},
  {"name": "totalAssets", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"type": "uint256"}]},
  {"name": "totalSupply", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"type": "uint256"}]}
];

const ERC20_ABI = [
  {"name": "symbol", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"type": "string"}]},
  {"name": "decimals", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"type": "uint8"}]},
  {"name": "approve", "type": "function", "stateMutability": "nonpayable", "inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}], "outputs": [{"type": "bool"}]},
  {"name": "balanceOf", "type": "function", "stateMutability": "view", "inputs": [{"name": "account", "type": "address"}], "outputs": [{"type": "uint256"}]},
  {"name": "allowance", "type": "function", "stateMutability": "view", "inputs": [{"name": "owner", "type": "address"}, {"name": "spender", "type": "address"}], "outputs": [{"type": "uint256"}]}
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
  const { connect, isLoading, pendingConnector } = useConnect();
  const { disconnect } = useDisconnect();
  const publicClient = usePublicClient();
  const [vaultLength, setVaultLength] = useState(0);
  const [vaults, setVaults] = useState([]);
  const [allTokens, setAllTokens] = useState([]);
  const [rawVaultDetails, setRawVaultDetails] = useState([]);
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
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [withdrawType, setWithdrawType] = useState({});
  const [showRebalanceForm, setShowRebalanceForm] = useState({});
  const [pendingApprovals, setPendingApprovals] = useState({});
  const [allowances, setAllowances] = useState({});

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
      const slot = 0n;
      const lengthHex = await publicClient.getStorageAt({
        address: FACTORY_ADDRESS,
        slot: `0x${slot.toString(16).padStart(64, '0')}`,
      });
      const lengthBigInt = hexToBigInt(lengthHex);
      const length = Number(lengthBigInt);
      setVaultLength(length);
    } catch (err) {
      console.error('Error reading vault length:', err);
      setError('Error reading vault length.');
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

  // Batch read vault data
  const vaultDataContracts = vaults.flatMap((vaultAddr) => [
    { address: vaultAddr, abi: VAULT_ABI, functionName: 'getTokens' },
    { address: vaultAddr, abi: VAULT_ABI, functionName: 'getAllocations' },
    { address: vaultAddr, abi: VAULT_ABI, functionName: 'holdings' },
    { address: vaultAddr, abi: VAULT_ABI, functionName: 'isRebalancer', args: [address] },
    { address: vaultAddr, abi: VAULT_ABI, functionName: 'totalAssets' },
    { address: vaultAddr, abi: VAULT_ABI, functionName: 'totalSupply' },
  ]);

  const { data: vaultData } = useReadContracts({
    contracts: vaultDataContracts,
    query: { enabled: vaults.length > 0 },
  });

  // Batch read allowances
  const allowanceContracts = vaults.map((vaultAddr) => ({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [address, vaultAddr]
  }));

  const { data: allowanceData } = useReadContracts({
    contracts: allowanceContracts,
    query: { enabled: vaults.length > 0 && isConnected && address },
  });

  useEffect(() => {
    if (allowanceData) {
      const newAllowances = {};
      vaults.forEach((vaultAddr, index) => {
        newAllowances[vaultAddr] = allowanceData[index]?.result || 0n;
      });
      setAllowances(newAllowances);
    }
  }, [allowanceData, vaults]);

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
      setRawVaultDetails(tempDetails);
    }
  }, [vaultData, vaults, address]);

  // Batch read token data
  const tokenDataContracts = allTokens.flatMap((tokenAddr) => [
    { address: tokenAddr, abi: ERC20_ABI, functionName: 'symbol' },
    { address: tokenAddr, abi: ERC20_ABI, functionName: 'decimals' },
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
    }
  }, [tokenData, allTokens]);

  const formattedVaultDetails = useMemo(() => {
    return rawVaultDetails.map((detail) => {
      const formattedUsdc = formatUnits(detail.usdcBal, USDC_DECIMALS);
      const formattedTokens = detail.tokenBals.map((bal, index) => {
        const tokenAddr = detail.tokens[index];
        const { symbol, decimals } = tokenDetailsMap[tokenAddr] || { symbol: 'Unknown', decimals: 18 };
        return { symbol, balance: formatUnits(bal, decimals) };
      });
      const formattedAllocations = detail.percentages.map((perc, index) => {
        const tokenAddr = detail.tokens[index];
        const { symbol } = tokenDetailsMap[tokenAddr] || { symbol: 'Unknown' };
        return { symbol, percent: perc };
      });
      const formattedTotalValue = formatUnits(detail.totalAssets, USDC_DECIMALS);
      let navPerShare = '0';
      if (detail.totalSupply > 0n) {
        navPerShare = formatUnits((detail.totalAssets * 10n ** 18n) / detail.totalSupply, USDC_DECIMALS);
      }
      return { ...detail, formattedUsdc, formattedTokens, formattedAllocations, formattedTotalValue, navPerShare };
    });
  }, [rawVaultDetails, tokenDetailsMap]);

  // Batch read user investments
  const investmentContracts = vaults.flatMap((vaultAddr) => [
    { address: vaultAddr, abi: ERC20_ABI, functionName: 'balanceOf', args: [address] },
    { address: vaultAddr, abi: ERC20_ABI, functionName: 'symbol' },
    { address: vaultAddr, abi: ERC20_ABI, functionName: 'decimals' },
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

  const { writeContract, data: writeHash } = useWriteContract();

  useEffect(() => {
    if (writeHash) {
      setTxHash(writeHash);
    }
  }, [writeHash]);

  useEffect(() => {
    if (txReceipt && txReceipt.status === 'success') {
      setRefreshKey((k) => k + 1);
      setPendingApprovals({});
    }
  }, [txReceipt]);

  const handleApproveAndDeposit = async (vaultAddr, amountIn, tokenLength) => {
    const scaledAmountIn = parseUnits(amountIn || '0', USDC_DECIMALS);
    const currentAllowance = allowances[vaultAddr] || 0n;
    
    if (currentAllowance < scaledAmountIn) {
      // Need approval first
      setPendingApprovals(prev => ({ ...prev, [vaultAddr]: 'approving' }));
      writeContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [vaultAddr, scaledAmountIn],
      });
    } else {
      // Already approved, proceed with deposit
      setPendingApprovals(prev => ({ ...prev, [vaultAddr]: 'depositing' }));
      const poolFees = Array(tokenLength).fill(500n);
      const minOuts = Array(tokenLength).fill(0n);
      writeContract({
        address: vaultAddr,
        abi: VAULT_ABI,
        functionName: 'deposit',
        args: [scaledAmountIn, poolFees, minOuts],
      });
    }
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
    setSelectedAllocations([]);
    setVaultName('');
    setVaultSymbol('');
    setShowCreateForm(false);
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
    setRebalanceAllocations({
      ...rebalanceAllocations,
      [index]: []
    });
    setShowRebalanceForm({
      ...showRebalanceForm,
      [index]: false
    });
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  const formatAddress = (addr) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const VaultCard = ({ detail, index }) => {
    const [depositValue, setDepositValue] = React.useState('');
    const [withdrawValue, setWithdrawValue] = React.useState('');
    const [withdrawMode, setWithdrawMode] = React.useState('prorata');

    const investment = userInvestments.find(inv => inv.address === detail.address);
    const isInvested = !!investment;
    const positionValue = investment
      ? (parseFloat(investment.balance) * parseFloat(detail.navPerShare)).toFixed(2)
      : '0';

    const [tokenName, setTokenName] = useState('');
    useEffect(() => {
      if (!detail.address) return;
      if (typeof window.ethereum === 'undefined') {
        console.error('Ethereum-Provider nicht gefunden. Bitte MetaMask o. Ä. installieren.');
        return;
      }
      const provider = new BrowserProvider(window.ethereum);
      const ERC20_ABI = ["function name() view returns (string)"];
      const contract = new Contract(detail.address, ERC20_ABI, provider);
      contract.name()
        .then(name => setTokenName(name))
        .catch(err => console.error('Fehler beim Laden des Token-Namens:', err));
    }, [detail.address]);

    const scaledDepositAmount = depositValue ? parseUnits(depositValue, USDC_DECIMALS) : 0n;
    const currentAllowance = allowances[detail.address] || 0n;
    const needsApproval = scaledDepositAmount > currentAllowance;
    const pendingState = pendingApprovals[detail.address];

    // New state for copy confirmation
    const [copied, setCopied] = React.useState(false);

    return (
      <div className={`bg-gradient-to-br from-slate-900 to-slate-800 rounded-3xl p-6 border-2 transition-all duration-300 hover:scale-105 hover:shadow-2xl ${
        isInvested ? 'border-emerald-500/50 shadow-emerald-500/20' : 'border-slate-700/50'
      } shadow-xl backdrop-blur-sm`}>
        
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl font-bold text-white ${
              isInvested ? 'bg-emerald-500' : 'bg-blue-500'
            }`}>
              {tokenName ? tokenName.charAt(0) : '₿'}
            </div>
            <div>
              <h3 className="text-xl font-bold text-white mb-1">
                {tokenName || `Vault #${index}`}
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-slate-400 text-sm font-mono">{formatAddress(detail.address)}</span>
                {/* Updated button with copy feedback and improved clickability */}
                <button
                  onClick={() => {
                    copyToClipboard(detail.address);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000); // Reset after 2 seconds
                  }}
                  className="relative text-slate-400 hover:text-white transition-colors p-1 rounded hover:bg-slate-700 cursor-pointer" // Added cursor-pointer for visible clickability
                >
                  {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                  {/* Simple tooltip for "Copied!" confirmation */}
                  {copied && (
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-1 bg-emerald-500 text-white text-xs px-2 py-1 rounded shadow-lg">
                      Copied!
                    </div>
                  )}
                </button>
              </div>
            </div>
          </div>
          {isInvested && (
            <div className="bg-emerald-500/20 border border-emerald-500/50 text-emerald-400 px-3 py-1 rounded-full text-sm font-medium">
              INVESTED
            </div>
          )}
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700/50">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign size={16} className="text-emerald-400" />
              <span className="text-slate-400 text-sm">TVL</span>
            </div>
            <span className="text-white font-bold text-lg">${parseFloat(detail.formattedTotalValue).toFixed(4)}</span>
          </div>
          <div className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700/50">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp size={16} className="text-blue-400" />
              <span className="text-slate-400 text-sm">NAV</span>
            </div>
            <span className="text-white font-bold text-lg">${parseFloat(detail.navPerShare).toFixed(4)}</span>
          </div>
        </div>

        {/* Asset Allocation */}
        <div className="mb-6">
          <h4 className="text-slate-300 font-medium text-sm mb-3">Asset Allocation</h4>
          <div className="flex flex-wrap gap-2">
            {detail.formattedAllocations?.map((alloc, i) => (
              <div key={i} className="bg-blue-500/20 border border-blue-500/30 text-blue-300 px-3 py-1 rounded-full text-sm font-medium">
                {alloc.symbol} {alloc.percent}%
              </div>
            ))}
          </div>
        </div>

        {/* Position Info */}
        {isInvested && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Wallet size={16} className="text-emerald-400" />
              <span className="text-emerald-300 font-medium">Your Position</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-slate-400 text-sm">Shares</span>
                <div className="text-white font-semibold">{parseFloat(investment?.balance || '0').toFixed(4)}</div>
              </div>
              <div>
                <span className="text-slate-400 text-sm">Value</span>
                <div className="text-emerald-400 font-semibold">${parseFloat(positionValue).toFixed(4)}</div>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-4">
          {/* Deposit */}
          <div className="space-y-3">
            <input
              type="number"
              placeholder="USDC Amount"
              value={depositValue}
              onChange={e => setDepositValue(e.target.value)}
              className="w-full bg-slate-800/50 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:bg-slate-800"
            />
            <button
              onClick={() => handleApproveAndDeposit(detail.address, depositValue || '0', detail.tokens.length)}
              disabled={!depositValue || pendingState}
              className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 disabled:from-slate-600 disabled:to-slate-700 text-white font-medium py-3 rounded-xl transition-all duration-200 flex items-center justify-center gap-2"
            >
              {pendingState === 'approving' ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Approving...
                </>
              ) : pendingState === 'depositing' ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Depositing...
                </>
              ) : needsApproval ? (
                <>
                  <Zap size={16} />
                  Approve & Invest
                </>
              ) : (
                <>
                  <DollarSign size={16} />
                  {isInvested ? 'Add Funds' : 'Invest'}
                </>
              )}
            </button>
          </div>

          {/* Withdraw */}
          {isInvested && (
            <div className="space-y-3 pt-4 border-t border-slate-700">
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="Shares"
                  value={withdrawValue}
                  onChange={e => setWithdrawValue(e.target.value)}
                  className="flex-1 bg-slate-800/50 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:border-red-500 focus:bg-slate-800"
                />
                <div className="relative">
                  <select
                    value={withdrawMode}
                    onChange={e => setWithdrawMode(e.target.value)}
                    className="appearance-none bg-slate-800/50 border border-slate-600 rounded-xl px-4 py-3 pr-10 text-white focus:outline-none focus:border-red-500 cursor-pointer"
                  >
                    <option value="prorata">Pro-Rata</option>
                    <option value="usdc">USDC</option>
                  </select>
                  <ChevronDown size={16} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              </div>
              <button
                onClick={() => {
                  if (withdrawMode === 'usdc') {
                    handleWithdrawUSDC(detail.address, withdrawValue || '0', detail.tokens.length);
                  } else {
                    handleWithdraw(detail.address, withdrawValue || '0');
                  }
                }}
                className="w-full bg-gradient-to-r from-red-500 to-pink-600 hover:from-red-600 hover:to-pink-700 text-white font-medium py-3 rounded-xl transition-all duration-200 flex items-center justify-center gap-2"
              >
                <Minus size={16} />
                Withdraw
              </button>
            </div>
          )}

          {/* Rebalance */}
          {detail.isRebalancer && (
            <div className="pt-4 border-t border-slate-700">
              <button
                onClick={() => setShowRebalanceForm(prev => ({ ...prev, [index]: !prev[index] }))}
                className="flex items-center justify-between w-full text-orange-400 hover:text-orange-300 transition-colors font-medium p-3 hover:bg-orange-500/10 rounded-xl"
              >
                <div className="flex items-center gap-2">
                  <Settings size={16} />
                  Rebalance Vault
                </div>
                {showRebalanceForm[index] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              
              {showRebalanceForm[index] && (
                <div className="mt-4 space-y-4 bg-orange-500/5 border border-orange-500/20 rounded-2xl p-4">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <select
                        value={selectedRebalanceTokens[index] || TOKEN_OPTIONS[0]}
                        onChange={(e) => setSelectedRebalanceTokens({...selectedRebalanceTokens, [index]: e.target.value})}
                        className="appearance-none w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 pr-10 text-white focus:outline-none focus:border-orange-500 cursor-pointer"
                      >
                        {TOKEN_OPTIONS.map(option => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                      <ChevronDown size={16} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>
                    <input
                      type="number"
                      placeholder="Percent"
                      value={rebalanceTokenPercents[index] || ''}
                      onChange={(e) => setRebalanceTokenPercents({...rebalanceTokenPercents, [index]: e.target.value})}
                      className="flex-1 bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:border-orange-500"
                    />
                    <button
                      onClick={() => handleAddRebalanceAllocation(index)}
                      className="bg-orange-500 hover:bg-orange-600 text-white font-medium px-4 py-3 rounded-xl transition-colors"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  
                  {(rebalanceAllocations[index] || []).length > 0 && (
                    <div className="space-y-3">
                      <h5 className="text-orange-300 font-medium">New Allocation:</h5>
                      {(rebalanceAllocations[index] || []).map((alloc, idx) => (
                        <div key={idx} className="flex items-center justify-between bg-slate-800/50 rounded-xl px-4 py-3 border border-slate-700">
                          <span className="text-white font-medium">{alloc.token}: {alloc.percent}%</span>
                          <button
                            onClick={() => handleRemoveRebalanceAllocation(index, alloc.token)}
                            className="text-red-400 hover:text-red-300 p-1 hover:bg-red-500/10 rounded"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => handleRebalance(index, detail.address, detail.tokens.length)}
                        className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-medium py-3 rounded-xl transition-all duration-200 flex items-center justify-center gap-2"
                      >
                        <Settings size={16} />
                        Execute Rebalance
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };
  
  // Calculate total portfolio value
  const totalPortfolioValue = userInvestments.reduce((total, inv) => {
    const vault = formattedVaultDetails.find(v => v.address === inv.address);
    if (vault) {
      return total + (parseFloat(inv.balance) * parseFloat(vault.navPerShare));
    }
    return total;
  }, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      
      <div className="container mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-12">
          <div>
            <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-emerald-400 bg-clip-text text-transparent mb-3">
              ₿ CryptoVaults
            </h1>
            <p className="text-slate-400 text-xl">Decentralized token fund protocol</p>
          </div>
          <div className="flex items-center gap-4">
            {isConnected ? (
              <>
                <button
                  onClick={() => setShowCreateForm(!showCreateForm)}
                  className="flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white rounded-2xl transition-all duration-200 font-medium shadow-lg hover:shadow-xl hover:scale-105"
                >
                  <Plus size={20} />
                  Create Vault
                </button>
                <div className="flex items-center gap-4 bg-slate-800/50 backdrop-blur-sm rounded-2xl px-6 py-3 border border-slate-700">
                  <div className="w-3 h-3 bg-emerald-400 rounded-full animate-pulse"></div>
                  <span className="text-white font-mono">{formatAddress(address)}</span>
                  <button
                    onClick={() => disconnect()}
                    className="text-slate-400 hover:text-red-400 transition-colors p-1 rounded hover:bg-red-500/10"
                    title="Disconnect"
                  >
                    <LogOut size={16} />
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 mb-8">
            <div className="flex items-center gap-3">
              <X size={20} className="text-red-400" />
              <p className="text-red-300 font-medium">{error}</p>
            </div>
          </div>
        )}

        {!isConnected ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center bg-slate-800/50 backdrop-blur-sm rounded-3xl p-12 max-w-md border border-slate-700">
              <div className="w-24 h-24 bg-gradient-to-br from-blue-500 to-purple-600 rounded-3xl flex items-center justify-center mx-auto mb-8">
                <Wallet size={48} className="text-white" />
              </div>
              <h2 className="text-3xl font-bold text-white mb-4">Connect Wallet</h2>
              <p className="text-slate-400 mb-8">Start investing in professionally managed crypto portfolios</p>
              <button
                onClick={() => connect({ connector: new metaMask() })}
                disabled={isLoading}
                className="w-full px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 disabled:from-slate-600 disabled:to-slate-700 text-white rounded-2xl transition-all duration-200 font-medium shadow-lg hover:shadow-xl flex items-center justify-center gap-3"
              >
                {isLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    Connecting...
                  </>
                ) : (
                  <>
                    <Wallet size={24} />
                    Connect MetaMask
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Create Vault Form */}
            {showCreateForm && (
              <div className="bg-slate-800/50 backdrop-blur-sm rounded-3xl p-8 mb-12 border border-slate-700">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-3xl font-bold text-white">Create New Vault</h2>
                  <button
                    onClick={() => setShowCreateForm(false)}
                    className="text-slate-400 hover:text-white p-2 hover:bg-slate-700 rounded-xl transition-colors"
                  >
                    <X size={24} />
                  </button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                  <div>
                    <label className="block text-slate-300 font-medium mb-3">Vault Name</label>
                    <input
                      type="text"
                      placeholder="e.g., Balanced Growth Fund"
                      value={vaultName}
                      onChange={(e) => setVaultName(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-600 rounded-2xl px-4 py-4 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-medium mb-3">Vault Symbol</label>
                    <input
                      type="text"
                      placeholder="e.g., BGF"
                      value={vaultSymbol}
                      onChange={(e) => setVaultSymbol(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-600 rounded-2xl px-4 py-4 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="mb-8">
                  <h3 className="text-xl font-medium text-white mb-6">Asset Allocation</h3>
                  <div className="flex gap-4 mb-6">
                    <div className="relative flex-1">
                      <select
                        value={selectedToken}
                        onChange={(e) => setSelectedToken(e.target.value)}
                        className="appearance-none w-full bg-slate-800 border border-slate-600 rounded-2xl px-4 py-4 pr-12 text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                      >
                        {TOKEN_OPTIONS.map(option => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                      <ChevronDown size={20} className="absolute right-4 top-1/2 transform -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>
                    <input
                      type="number"
                      placeholder="Percentage (0-100)"
                      value={tokenPercent}
                      onChange={(e) => setTokenPercent(e.target.value)}
                      className="flex-1 bg-slate-800 border border-slate-600 rounded-2xl px-4 py-4 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={handleAddAllocation}
                      className="bg-blue-500 hover:bg-blue-600 text-white font-medium px-6 py-4 rounded-2xl transition-colors"
                    >
                      <Plus size={20} />
                    </button>
                  </div>

                  {selectedAllocations.length > 0 && (
                    <div className="space-y-4 mb-6">
                      <h4 className="text-slate-300 font-medium">Current Allocation:</h4>
                      <div className="grid gap-3">
                        {selectedAllocations.map((alloc, idx) => (
                          <div key={idx} className="flex items-center justify-between bg-slate-800/50 rounded-2xl px-4 py-3 border border-slate-700">
                            <span className="text-white font-medium">{alloc.token}: {alloc.percent}%</span>
                            <button
                              onClick={() => handleRemoveAllocation(alloc.token)}
                              className="text-red-400 hover:text-red-300 p-2 hover:bg-red-500/10 rounded-xl transition-colors"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="text-slate-400">
                        Total: {selectedAllocations.reduce((sum, alloc) => sum + parseInt(alloc.percent || 0), 0)}%
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-4">
                  <button
                    onClick={handleCreate}
                    disabled={selectedAllocations.length === 0 || !vaultName || !vaultSymbol}
                    className="flex-1 px-6 py-4 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 disabled:from-slate-600 disabled:to-slate-700 disabled:cursor-not-allowed text-white rounded-2xl transition-all duration-200 font-medium flex items-center justify-center gap-3"
                  >
                    <Check size={20} />
                    Create Vault
                  </button>
                  <button
                    onClick={() => setShowCreateForm(false)}
                    className="px-6 py-4 bg-slate-700 hover:bg-slate-600 text-white rounded-2xl transition-colors font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
              <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl p-6 border border-slate-700/50 backdrop-blur-sm">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-14 h-14 bg-blue-500/20 rounded-2xl flex items-center justify-center">
                    <Users size={28} className="text-blue-400" />
                  </div>
                  <div>
                    <p className="text-slate-400 text-sm">Total Vaults</p>
                    <p className="text-3xl font-bold text-white">{vaultLength}</p>
                  </div>
                </div>
              </div>
              
              <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl p-6 border border-slate-700/50 backdrop-blur-sm">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-14 h-14 bg-emerald-500/20 rounded-2xl flex items-center justify-center">
                    <Wallet size={28} className="text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-slate-400 text-sm">Your Positions</p>
                    <p className="text-3xl font-bold text-white">{userInvestments.length}</p>
                  </div>
                </div>
              </div>
              
              <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl p-6 border border-slate-700/50 backdrop-blur-sm">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-14 h-14 bg-purple-500/20 rounded-2xl flex items-center justify-center">
                    <DollarSign size={28} className="text-purple-400" />
                  </div>
                  <div>
                    <p className="text-slate-400 text-sm">Portfolio Value</p>
                    <p className="text-3xl font-bold text-white">${totalPortfolioValue.toFixed(4)}</p>
                  </div>
                </div>
              </div>
              
              <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl p-6 border border-slate-700/50 backdrop-blur-sm">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-14 h-14 bg-orange-500/20 rounded-2xl flex items-center justify-center">
                    <TrendingUp size={28} className="text-orange-400" />
                  </div>
                  <div>
                    <p className="text-slate-400 text-sm">Total TVL</p>
                    <p className="text-3xl font-bold text-white">
                      ${formattedVaultDetails.reduce((sum, vault) => sum + parseFloat(vault.formattedTotalValue), 0).toFixed(4)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Vaults Grid */}
            {formattedVaultDetails.length > 0 ? (
              <div>
                <h2 className="text-3xl font-bold text-white mb-8 flex items-center gap-4">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center">
                    <TrendingUp className="text-white" size={24} />
                  </div>
                  All Vaults
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8">
                  {formattedVaultDetails.map((detail, index) => (
                    <VaultCard key={detail.address} detail={detail} index={index} />
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center min-h-[40vh]">
                <div className="text-center bg-slate-800/50 backdrop-blur-sm rounded-3xl p-12 max-w-md border border-slate-700">
                  <div className="w-24 h-24 bg-gradient-to-br from-blue-500 to-purple-600 rounded-3xl flex items-center justify-center mx-auto mb-8">
                    <TrendingUp size={48} className="text-white" />
                  </div>
                  <h2 className="text-3xl font-bold text-white mb-4">No Vaults Yet</h2>
                  <p className="text-slate-400 mb-8">Be the first to create a crypto vault and start the revolution!</p>
                  <button
                    onClick={() => setShowCreateForm(true)}
                    className="px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white rounded-2xl transition-all duration-200 font-medium shadow-lg hover:shadow-xl flex items-center gap-3 mx-auto"
                  >
                    <Plus size={24} />
                    Create First Vault
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default App;