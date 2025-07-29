import React, { useState } from "react";
import {
  WagmiProvider,
  createConfig,
  http,
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { metaMask } from "@wagmi/connectors";
import { base } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { formatUnits, parseUnits, parseAbi } from "viem";
import { 
  Wallet, 
  TrendingUp, 
  DollarSign, 
  PieChart, 
  ArrowUpRight, 
  ArrowDownLeft,
  Coins,
  RefreshCw,
  Activity,
  BarChart3,
  Settings,
  LogOut
} from "lucide-react";

// ---------------------------------------------------------------------------
// Wagmi Config & QueryClient
// ---------------------------------------------------------------------------
const wagmiConfig = createConfig({
  chains: [base],
  transports: { [base.id]: http("https://mainnet.base.org") },
  connectors: [metaMask()],
  ssr: false,
});
const queryClient = new QueryClient();

// ---------------------------------------------------------------------------
// Contract & Feed Addresses
// ---------------------------------------------------------------------------
const vaultAddress = "0x0D1B9ea40F271c0f2b876A696104f58A6D6c3Ed9";
const usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const feedEthUsd = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";
const feedBtcUsd = "0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F";

// ---------------------------------------------------------------------------
// ABIs
// ---------------------------------------------------------------------------
const vaultAbi = parseAbi([
  "function deposit(uint256 amountIn,uint24 feeWETH,uint24 feeWBTC,uint256 minOutWETH,uint256 minOutWBTC)",
  "function withdraw(uint256 shares)",
  "function withdrawUSDC(uint256 shares,uint24 poolFeeETHtoUSDC,uint24 poolFeeBTCtoUSDC,uint256 minOutETH,uint256 minOutBTC)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function holdings() view returns (uint256 usdcBal,uint256 wethBal,uint256 wbtcBal)",
]);

const erc20Abi = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
]);

const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)"
]);

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------
const toNumber = (bn, decimals) => Number(formatUnits(bn ?? 0n, decimals));

const formatCurrency = (value) => {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const formatNumber = (value, decimals = 2) => {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
function VaultUI() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { writeContractAsync } = useWriteContract();

  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawShares, setWithdrawShares] = useState("");
  const [withdrawMode, setWithdrawMode] = useState('assets');

  // ------- Reads ----------------------------------------------------------
  const { data: totalAssets } = useReadContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "totalAssets",
    watch: true,
  });
  const { data: totalSupply } = useReadContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "totalSupply",
    watch: true,
  });
  const { data: myShares } = useReadContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "balanceOf",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    enabled: Boolean(address),
    watch: true,
  });
  const { data: holdings } = useReadContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "holdings",
    watch: true,
  });

  const { data: ethFeed } = useReadContract({
    address: feedEthUsd,
    abi: feedAbi,
    functionName: "latestRoundData",
    watch: true,
  });
  const { data: btcFeed } = useReadContract({
    address: feedBtcUsd,
    abi: feedAbi,
    functionName: "latestRoundData",
    watch: true,
  });

  // ------- Derived numbers -----------------------------------------------
  const ethPrice = ethFeed ? Number(ethFeed[1]) / 1e8 : 0;
  const btcPrice = btcFeed ? Number(btcFeed[1]) / 1e8 : 0;

  const navPerShare =
    totalAssets && totalSupply && totalSupply > 0n ?
      toNumber(totalAssets, 6) / toNumber(totalSupply, 18) : 0;

  const walletShares = myShares ? toNumber(myShares, 18) : 0;
  const walletValue = walletShares * navPerShare;

  const usdcBal = holdings ? toNumber(holdings[0], 6) : 0;
  const wethBal = holdings ? toNumber(holdings[1], 18) : 0;
  const wbtcBal = holdings ? toNumber(holdings[2], 8) : 0;

  const usdcVal = usdcBal;
  const wethVal = wethBal * ethPrice;
  const wbtcVal = wbtcBal * btcPrice;
  const totalVal = usdcVal + wethVal + wbtcVal;

  const pct = (v) => totalVal > 0 ? (v / totalVal * 100) : 0;

  // ------- Actions --------------------------------------------------------
  async function handleDeposit() {
    if (!depositAmount) return;
    const amountIn = parseUnits(depositAmount, 6);
    await writeContractAsync({ address: usdcAddress, abi: erc20Abi, functionName: "approve", args: [vaultAddress, amountIn] });
    await writeContractAsync({ address: vaultAddress, abi: vaultAbi, functionName: "deposit", args: [amountIn, 500, 3000, 0, 0] });
    setDepositAmount("");
  }

  async function handleWithdraw() {
    if (!withdrawShares) return;
    const sharesIn = parseUnits(withdrawShares, 18);
    if (withdrawMode === 'assets') {
      await writeContractAsync({ address: vaultAddress, abi: vaultAbi, functionName: "withdraw", args: [sharesIn] });
    } else {
      await writeContractAsync({ address: vaultAddress, abi: vaultAbi, functionName: "withdrawUSDC", args: [sharesIn, 500, 3000, 0n, 0n] });
    }
    setWithdrawShares("");
  }

  // ------- UI Components --------------------------------------------------
  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 flex items-center justify-center p-6">
        <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-12 text-center max-w-md w-full border border-white/20 shadow-2xl">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-400 to-purple-500 rounded-2xl flex items-center justify-center mx-auto mb-8">
            <Wallet className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-4">Crypto ETF</h1>
          <p className="text-blue-200 mb-8 text-lg">Verbinden Sie Ihr Wallet um zu starten</p>
          <button 
            onClick={() => connect({ connector: metaMask() })}
            className="w-full py-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-semibold rounded-2xl hover:from-blue-600 hover:to-purple-700 transition-all duration-300 shadow-lg hover:shadow-xl flex items-center justify-center gap-3"
          >
            <Wallet className="w-5 h-5" />
            MetaMask verbinden
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-purple-600 rounded-xl flex items-center justify-center">
                <PieChart className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Crypto ETF</h1>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 rounded-xl">
                <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                <span className="text-sm font-medium text-gray-700">
                  {address?.slice(0, 6)}...{address?.slice(-4)}
                </span>
              </div>
              <button 
                onClick={disconnect}
                className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
                title="Disconnect"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Portfolio Overview */}
        <div className="mb-8">
          <div className="text-center mb-8">
            <h2 className="text-lg font-medium text-gray-600 mb-2">Your Share Value</h2>
            <div className="text-5xl font-bold text-gray-900 mb-4">{formatCurrency(walletValue)}</div>
            <div className="flex items-center justify-center gap-6 text-sm text-gray-500">
              <span>{formatNumber(walletShares, 6)} vETF Shares</span>
              <span>•</span>
              <span>NAV: ${formatNumber(navPerShare, 6)}</span>
            </div>
          </div>

          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Fund AUM</p>
                  <p className="text-xl font-bold text-gray-900">{formatCurrency(totalVal)}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Performance</p>
                  <p className="text-xl font-bold text-green-600">+12.4%</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
                  <Coins className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">ETH Preis</p>
                  <p className="text-xl font-bold text-gray-900">{formatCurrency(ethPrice)}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
                  <Coins className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">BTC Preis</p>
                  <p className="text-xl font-bold text-gray-900">{formatCurrency(btcPrice)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Portfolio Allocation */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
              <div className="p-6 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-semibold text-gray-900">Asset Allocation</h3>
                  <RefreshCw className="w-5 h-5 text-gray-400" />
                </div>
              </div>
              
              <div className="p-6">
                {/* Donut Chart Visualization */}
                <div className="flex items-center justify-center mb-8">
                  <div className="relative w-48 h-48">
                    <svg className="w-48 h-48 transform -rotate-90" viewBox="0 0 100 100">
                      <circle
                        cx="50"
                        cy="50"
                        r="35"
                        fill="none"
                        stroke="#f3f4f6"
                        strokeWidth="12"
                      />
                      {/* USDC Segment */}
                      <circle
                        cx="50"
                        cy="50"
                        r="35"
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="12"
                        strokeDasharray={`${pct(usdcVal) * 2.2} 220`}
                        strokeDashoffset="0"
                        className="transition-all duration-500"
                      />
                      {/* ETH Segment */}
                      <circle
                        cx="50"
                        cy="50"
                        r="35"
                        fill="none"
                        stroke="#3b82f6"
                        strokeWidth="12"
                        strokeDasharray={`${pct(wethVal) * 2.2} 220`}
                        strokeDashoffset={`-${pct(usdcVal) * 2.2}`}
                        className="transition-all duration-500"
                      />
                      {/* BTC Segment */}
                      <circle
                        cx="50"
                        cy="50"
                        r="35"
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth="12"
                        strokeDasharray={`${pct(wbtcVal) * 2.2} 220`}
                        strokeDashoffset={`-${(pct(usdcVal) + pct(wethVal)) * 2.2}`}
                        className="transition-all duration-500"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center">
                        <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalVal)}</p>
                        <p className="text-sm text-gray-500">Fund AUM</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Asset Details */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                      <div>
                        <p className="font-semibold text-gray-900">USDC</p>
                        <p className="text-sm text-gray-500">{formatNumber(usdcBal)} USDC</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-gray-900">{formatCurrency(usdcVal)}</p>
                      <p className="text-sm text-gray-500">{formatNumber(pct(usdcVal), 1)}%</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                      <div>
                        <p className="font-semibold text-gray-900">Ethereum</p>
                        <p className="text-sm text-gray-500">{formatNumber(wethBal, 6)} ETH</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-gray-900">{formatCurrency(wethVal)}</p>
                      <p className="text-sm text-gray-500">{formatNumber(pct(wethVal), 1)}%</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
                      <div>
                        <p className="font-semibold text-gray-900">Bitcoin</p>
                        <p className="text-sm text-gray-500">{formatNumber(wbtcBal, 6)} BTC</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-gray-900">{formatCurrency(wbtcVal)}</p>
                      <p className="text-sm text-gray-500">{formatNumber(pct(wbtcVal), 1)}%</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Actions Panel */}
          <div className="space-y-6">
            {/* Deposit */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
              <div className="p-6 bg-gradient-to-r from-green-50 to-emerald-50 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                    <ArrowUpRight className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Einzahlung</h3>
                    <p className="text-sm text-gray-600">USDC hinzufügen</p>
                  </div>
                </div>
              </div>
              
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Betrag (USDC)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all text-lg"
                  />
                </div>
                <button
                  onClick={handleDeposit}
                  className="w-full py-3 bg-gradient-to-r from-green-600 to-green-700 text-white font-semibold rounded-xl hover:from-green-700 hover:to-green-800 transition-all duration-200 shadow-lg hover:shadow-xl"
                >
                  Einzahlen
                </button>
              </div>
            </div>

            {/* Withdraw */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
              <div className="p-6 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                    <ArrowDownLeft className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Auszahlung</h3>
                    <p className="text-sm text-gray-600">vETF Shares verkaufen</p>
                  </div>
                </div>
              </div>
              
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Shares (vETF)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.000001"
                    placeholder="0.000000"
                    value={withdrawShares}
                    onChange={(e) => setWithdrawShares(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-lg"
                  />
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      checked={withdrawMode === 'assets'}
                      onChange={() => setWithdrawMode('assets')}
                      className="form-radio text-blue-600"
                    />
                    Pro-rata Assets (USDC, ETH, BTC)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      checked={withdrawMode === 'usdc'}
                      onChange={() => setWithdrawMode('usdc')}
                      className="form-radio text-blue-600"
                    />
                    Alles in USDC (ETH/BTC swappen)
                  </label>
                </div>
                <button
                  onClick={handleWithdraw}
                  className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-lg hover:shadow-xl"
                >
                  Auszahlen
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

//--------------------------------------------------------------------------
// App Wrapper
//--------------------------------------------------------------------------
export default function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <VaultUI />
      </QueryClientProvider>
    </WagmiProvider>
  );
}