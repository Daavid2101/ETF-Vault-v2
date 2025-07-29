// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// ────────────────────────────────────────────────────────────────
/// External deps
/// ────────────────────────────────────────────────────────────────
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import "./interfaces/ISwapRouter02_08.sol";

/// ────────────────────────────────────────────────────────────────
/// ETFVault
/// ────────────────────────────────────────────────────────────────
/**
 * @dev Vault-Token = Anteil am Gesamt‐NAV (ERC-4626-ähnlich, aber hand-rolled).
 *      • Deposit USDC → Vault kauft 50 % WETH / 30 % cbBTC.
 *      • Mint-Logik nutzt Chainlink-Preise zur fairen NAV-Berechnung.
 *      • Withdraw liefert assets pro-rata oder tauscht alles zu USDC.
 *
 *      !!! POC / UNAUDITED – nutze nur im Testnetz !!!
 */
contract ETFVault is ERC20, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /*───────────────────  network constants (Base mainnet) ──────────────────*/
    IERC20 public constant USDC = IERC20(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
    IERC20 public constant WETH = IERC20(0x4200000000000000000000000000000000000006);
    IERC20 public constant WBTC = IERC20(0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf);

    AggregatorV3Interface private constant FEED_ETH_USD =
        AggregatorV3Interface(0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70);
    AggregatorV3Interface private constant FEED_BTC_USD =
        AggregatorV3Interface(0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F);

    ISwapRouter02 public immutable router;

    /*──────────────────────  allocation & decimals  ────────────────────────*/
    uint256 private constant PCT_WETH = 50;
    uint256 private constant PCT_WBTC = 30;              // rest ≈ 20 % in USDC
    uint256 private constant USDC_DECIMALS = 1e6;
    uint256 private constant TOKEN_DECIMALS = 1e18;

    /*────────────────────────────  events  ──────────────────────────────────*/
    event Deposited(address indexed user, uint256 usdcIn, uint256 sharesOut);
    event Withdrawn(address indexed user, uint256 sharesBurned, uint256 usdcOut, uint256 wethOut, uint256 wbtcOut);
    event WithdrawnUSDC(address indexed user, uint256 sharesBurned, uint256 usdcOut);
    event Rebalanced(uint256 newUsdc, uint256 newWeth, uint256 newWbtc);

    /*────────────────────────  constructor  ─────────────────────────────────*/
    /**
     * @param _router ist der UniSwap Router auf dem Netzwerk, auf dem deployed wird
     * @notice Wir approven direkt den Zugriff des Routers auf inf Tokens der jeweiligen Holdings.
     */
    constructor(address _router) ERC20("ETF Vault Token", "vETF") Ownable(msg.sender) {
        router = ISwapRouter02(_router);
        USDC.approve(_router, type(uint256).max);
        WETH.approve(_router, type(uint256).max);
        WBTC.approve(_router, type(uint256).max);
    }

    /*───────────────────  user-facing API (deposit / withdraw)  ─────────────*/

    /**
     * @notice Deposit USDC, mint Vault-Shares und kaufe Target-Allocation.
     */
    function deposit(
        uint256 amountIn,
        uint24  poolFeeWETH,
        uint24  poolFeeWBTC,
        uint256 minOutWETH,
        uint256 minOutWBTC
    ) external nonReentrant {
        require(amountIn > 0, "amountIn = 0");

        uint256 supplyBefore = totalSupply();
        uint256 assetsBefore = _totalAssets();  // 6-decimal USDC-equivalent
        uint256 shares;

        if (supplyBefore == 0) {
            // Erstdeposit: 1 USDC (6d) → 1 Share (18d)
            shares = amountIn * (TOKEN_DECIMALS / USDC_DECIMALS);
        } else {
            // Shares = amountIn * supply / NAV (alle in 6-dec-SC)
            shares = (amountIn * supplyBefore) / assetsBefore;
        }
        require(shares > 0, "ZERO_SHARES");

        // Pull & Mint
        USDC.safeTransferFrom(msg.sender, address(this), amountIn);
        _mint(msg.sender, shares);

        // Execute Swaps: 50% → WETH, 30% → WBTC
        _swapUSDCfor(WETH, (amountIn * PCT_WETH) / 100, poolFeeWETH, minOutWETH);
        _swapUSDCfor(WBTC, (amountIn * PCT_WBTC) / 100, poolFeeWBTC, minOutWBTC);

        emit Deposited(msg.sender, amountIn, shares);
    }

    /**
     * @notice Redeem Shares pro-rata aller Assets. Burn Shares.
     */
    function withdraw(uint256 shares) external nonReentrant {
        require(shares > 0, "shares = 0");
        uint256 supply = totalSupply();
        require(shares <= supply, "exceeds supply");

        uint256 usdcOut = (USDC.balanceOf(address(this)) * shares) / supply;
        uint256 wethOut = (WETH.balanceOf(address(this)) * shares) / supply;
        uint256 wbtcOut = (WBTC.balanceOf(address(this)) * shares) / supply;

        _burn(msg.sender, shares);

        USDC.safeTransfer(msg.sender, usdcOut);
        WETH.safeTransfer(msg.sender, wethOut);
        WBTC.safeTransfer(msg.sender, wbtcOut);

        emit Withdrawn(msg.sender, shares, usdcOut, wethOut, wbtcOut);
    }

    /**
     * @notice Burn Shares und zahle reines USDC aus (Swaps inkl.).
     */
    function withdrawUSDC(
        uint256 shares,
        uint24  poolFeeETHtoUSDC,
        uint24  poolFeeBTCtoUSDC,
        uint256 minOutETH,
        uint256 minOutBTC
    ) external nonReentrant {
        require(shares > 0, "shares = 0");
        uint256 supply = totalSupply();
        require(shares <= supply, "exceeds supply");

        uint256 usdcPart = (USDC.balanceOf(address(this)) * shares) / supply;
        uint256 wethPart = (WETH.balanceOf(address(this)) * shares) / supply;
        uint256 wbtcPart = (WBTC.balanceOf(address(this)) * shares) / supply;

        _burn(msg.sender, shares);
        uint256 usdcBefore = USDC.balanceOf(address(this));

        if (wethPart > 0) {
            _swapExactInputSingle(address(WETH), address(USDC), poolFeeETHtoUSDC, wethPart, minOutETH);
        }
        if (wbtcPart > 0) {
            _swapExactInputSingle(address(WBTC), address(USDC), poolFeeBTCtoUSDC, wbtcPart, minOutBTC);
        }

        uint256 swapProceeds = USDC.balanceOf(address(this)) - usdcBefore;
        uint256 payout = usdcPart + swapProceeds;
        if (payout > USDC.balanceOf(address(this))) payout = USDC.balanceOf(address(this));
        /**
         * ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
         * @notice Sollte eigentlich nie true sein, außer Fehler in den Swaps. Hier ggf. catch & Fallback ausdenken wie zB auf withdraw()
         */

        USDC.safeTransfer(msg.sender, payout);
        emit WithdrawnUSDC(msg.sender, shares, payout);
    }

    /*───────────────────  owner-only rebalance  ──────────────────────────*/
    function rebalance(
        uint24 poolFeeETHtoUSDC,
        uint24 poolFeeBTCtoUSDC,
        uint24 poolFeeUSDCtoETH,
        uint24 poolFeeUSDCtoBTC,
        uint256 minOutUSDCfromETH,
        uint256 minOutUSDCfromBTC,
        uint256 minOutETH,
        uint256 minOutBTC
    ) external onlyOwner nonReentrant {
        uint256 wethBal = WETH.balanceOf(address(this));
        uint256 wbtcBal = WBTC.balanceOf(address(this));
        if (wethBal > 0) _swapExactInputSingle(address(WETH), address(USDC), poolFeeETHtoUSDC, wethBal, minOutUSDCfromETH);
        if (wbtcBal > 0) _swapExactInputSingle(address(WBTC), address(USDC), poolFeeBTCtoUSDC, wbtcBal, minOutUSDCfromBTC);

        uint256 usdcBal = USDC.balanceOf(address(this));
        uint256 toWETH = (usdcBal * PCT_WETH) / 100;
        uint256 toWBTC = (usdcBal * PCT_WBTC) / 100;
        _swapUSDCfor(WETH, toWETH, poolFeeUSDCtoETH, minOutETH);
        _swapUSDCfor(WBTC, toWBTC, poolFeeUSDCtoBTC, minOutBTC);
        emit Rebalanced(USDC.balanceOf(address(this)), WETH.balanceOf(address(this)), WBTC.balanceOf(address(this)));
    }

    /*─────────────────────  view helpers  ─────────────────────────────────*/
    function totalAssets() external view returns (uint256) {
        return _totalAssets();
    }

    function _totalAssets() internal view returns (uint256) {
        uint256 usdcVal = USDC.balanceOf(address(this));                  // 6-dec
        (, int256 pEth,,,) = FEED_ETH_USD.latestRoundData();               // 8-dec
        (, int256 pBtc,,,) = FEED_BTC_USD.latestRoundData();               // 8-dec
        uint256 wethVal = (WETH.balanceOf(address(this)) * uint256(pEth) * USDC_DECIMALS) / (1e18 * 1e8);
        uint256 wbtcVal = (WBTC.balanceOf(address(this)) * uint256(pBtc) * USDC_DECIMALS) / (1e8 * 1e8);
        return usdcVal + wethVal + wbtcVal;                               // 6-dec USDC-equivalent
    }

    function holdings() external view returns (uint256 usdcBal, uint256 wethBal, uint256 wbtcBal) {
        return (USDC.balanceOf(address(this)), WETH.balanceOf(address(this)), WBTC.balanceOf(address(this)));
    }

    /*─────────────────────  internal swap helpers  ───────────────────────*/
    function _swapUSDCfor(IERC20 tokenOut, uint256 amountIn, uint24 feeTier, uint256 minOut) internal {
        if (amountIn == 0) return;
        _swapExactInputSingle(address(USDC), address(tokenOut), feeTier, amountIn, minOut);
    }

    function _swapExactInputSingle(
        address tokenIn,
        address tokenOut,
        uint24 feeTier,
        uint256 amountIn,
        uint256 minOut
    ) internal {
        ISwapRouter02.ExactInputSingleParams memory params = ISwapRouter02.ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: feeTier,
            recipient: address(this),
            amountIn: amountIn,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0
        });
        router.exactInputSingle(params);
    }
}
