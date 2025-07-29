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
/// ETFVaultV2
/// ────────────────────────────────────────────────────────────────
/**
 * @dev Vault-Token = Anteil am Gesamt‐NAV (ERC-4626-ähnlich, aber hand-rolled).
 *      • Deposit USDC → Vault kauft Assets gemäß Allokation.
 *      • Mint-Logik nutzt Chainlink-Preise zur fairen NAV-Berechnung.
 *      • Withdraw liefert assets pro-rata oder tauscht alles zu USDC.
 *
 *      !!! POC / UNAUDITED – nutze nur im Testnetz !!!
 */
contract ETFVaultV2 is ERC20, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /*───────────────────  network constants (Base mainnet) ──────────────────*/
    IERC20 public constant USDC = IERC20(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
    IERC20 public constant WETH = IERC20(0x4200000000000000000000000000000000000006);
    IERC20 public constant cbBTC = IERC20(0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf);
    IERC20 public constant cbXRP = IERC20(0xcb585250f852C6c6bf90434AB21A00f02833a4af);

    AggregatorV3Interface public constant FEED_ETH_USD = AggregatorV3Interface(0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70);
    AggregatorV3Interface public constant FEED_BTC_USD = AggregatorV3Interface(0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F);
    AggregatorV3Interface public constant FEED_XRP_USD = AggregatorV3Interface(0x9f0C1dD78C4CBdF5b9cf923a549A201EdC676D34);

    ISwapRouter02 public constant router = ISwapRouter02(0x2626664c2603336E57B271c5C0b26F421741e481);

    mapping(string => IERC20) private tokenMap;
    mapping(string => AggregatorV3Interface) private feedMap;

    IERC20[] public tokens; // Liste der Tokens (z.B. WETH, WBTC), exkl. USDC
    uint256[] public percentages; // Prozentsätze für die Tokens, Summe <= 100, Rest in USDC
    mapping(address => bool) public isRebalancer;

    /*──────────────────────  decimals  ────────────────────────*/
    uint256 private constant USDC_DECIMALS = 1e6;
    uint256 private constant TOKEN_DECIMALS = 1e18;

    /*────────────────────────────  events  ──────────────────────────────────*/
    event Deposited(address indexed user, uint256 usdcIn, uint256 sharesOut);
    event Withdrawn(address indexed user, uint256 sharesBurned, uint256 usdcOut, uint256[] tokenOuts);
    event WithdrawnUSDC(address indexed user, uint256 sharesBurned, uint256 usdcOut);
    event Rebalanced(uint256 newUsdc, uint256[] newTokenBals, uint256[] newPercentages, address[] newTokenAddresses);
    event RebalancerAdded(address indexed rebalancer);
    event RebalancerRemoved(address indexed rebalancer);

    /*────────────────────────  constructor  ─────────────────────────────────*/
    /**
     * @param _initialTokenNames Liste der Token-Namen (z.B. ["WETH", "cbBTC"])
     * @param _initialPercentages Initiale Prozentsätze (müssen zu _initialTokenNames passen, Summe <= 100)
     * @param _rebalancers Liste der Adressen, die rebalancen dürfen
     * @notice Wir approven direkt den Zugriff des Routers auf inf Tokens der jeweiligen Holdings.
     */
    constructor(
        string[] memory _initialTokenNames,
        uint256[] memory _initialPercentages,
        address[] memory _rebalancers,
        string memory _name,
        string memory _symbol
    ) ERC20(_name, _symbol) Ownable(msg.sender) {
        require(_initialTokenNames.length == _initialPercentages.length, "Tokens and percentages mismatch");

        uint256 totalPct = 0;
        for (uint256 i = 0; i < _initialPercentages.length; i++) {
            totalPct += _initialPercentages[i];
            require(totalPct <= 100, "Total percentages exceed 100");
        }

        // Initialize token and feed maps
        tokenMap["WETH"] = WETH;
        tokenMap["cbBTC"] = cbBTC;
        tokenMap["cbXRP"] = cbXRP;

        feedMap["WETH"] = FEED_ETH_USD;
        feedMap["cbBTC"] = FEED_BTC_USD;
        feedMap["cbXRP"] = FEED_XRP_USD;

        // Set initial tokens and percentages
        percentages = _initialPercentages;
        tokens = new IERC20[](_initialTokenNames.length);
        for (uint256 i = 0; i < _initialTokenNames.length; i++) {
            string memory name = _initialTokenNames[i];
            require(address(tokenMap[name]) != address(0), "Invalid token name");
            tokens[i] = tokenMap[name];
        }

        USDC.approve(address(router), type(uint256).max);
        WETH.approve(address(router), type(uint256).max);
        cbBTC.approve(address(router), type(uint256).max);
        cbXRP.approve(address(router), type(uint256).max);

        isRebalancer[msg.sender] = true;

        for (uint256 i = 0; i < _rebalancers.length; i++) {
            isRebalancer[_rebalancers[i]] = true;
            emit RebalancerAdded(_rebalancers[i]);
        }
    }

    /*───────────────────  user-facing API (deposit / withdraw)  ─────────────*/

    /**
     * @notice Deposit USDC, mint Vault-Shares und kaufe Target-Allocation.
     * @param amountIn USDC-Menge
     * @param poolFees Fee-Tiers für Swaps zu jedem Token
     * @param minOuts Min-Outs für Swaps zu jedem Token
     */
    function deposit(
        uint256 amountIn,
        uint24[] calldata poolFees,
        uint256[] calldata minOuts
    ) external nonReentrant {
        require(amountIn > 0, "amountIn = 0");
        require(poolFees.length == tokens.length, "Pool fees mismatch");
        require(minOuts.length == tokens.length, "Min outs mismatch");

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

        // Execute Swaps zu jedem Token gemäß Allokation
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 swapAmount = (amountIn * percentages[i]) / 100;
            if (swapAmount > 0) {
                _swapUSDCfor(tokens[i], swapAmount, poolFees[i], minOuts[i]);
            }
        }

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
        uint256[] memory tokenOuts = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            tokenOuts[i] = (tokens[i].balanceOf(address(this)) * shares) / supply;
        }

        _burn(msg.sender, shares);

        USDC.safeTransfer(msg.sender, usdcOut);
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokenOuts[i] > 0) {
                tokens[i].safeTransfer(msg.sender, tokenOuts[i]);
            }
        }

        emit Withdrawn(msg.sender, shares, usdcOut, tokenOuts);
    }

    /**
     * @notice Burn Shares und zahle reines USDC aus (Swaps inkl.).
     * @param shares Zu burnende Shares
     * @param poolFees Fee-Tiers für Swaps von jedem Token zu USDC
     * @param minOuts Min-Outs für Swaps von jedem Token
     */
    function withdrawUSDC(
        uint256 shares,
        uint24[] calldata poolFees,
        uint256[] calldata minOuts
    ) external nonReentrant {
        require(shares > 0, "shares = 0");
        uint256 supply = totalSupply();
        require(shares <= supply, "exceeds supply");
        require(poolFees.length == tokens.length, "Pool fees mismatch");
        require(minOuts.length == tokens.length, "Min outs mismatch");

        uint256 usdcPart = (USDC.balanceOf(address(this)) * shares) / supply;
        uint256[] memory tokenParts = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            tokenParts[i] = (tokens[i].balanceOf(address(this)) * shares) / supply;
        }

        _burn(msg.sender, shares);
        uint256 usdcBefore = USDC.balanceOf(address(this));

        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokenParts[i] > 0) {
                _swapExactInputSingle(address(tokens[i]), address(USDC), poolFees[i], tokenParts[i], minOuts[i]);
            }
        }

        uint256 swapProceeds = USDC.balanceOf(address(this)) - usdcBefore;
        uint256 payout = usdcPart + swapProceeds;
        if (payout > USDC.balanceOf(address(this))) payout = USDC.balanceOf(address(this));

        USDC.safeTransfer(msg.sender, payout);
        emit WithdrawnUSDC(msg.sender, shares, payout);
    }

    /*───────────────────  rebalance (authorized)  ──────────────────────────*/
    modifier onlyRebalancer() {
        require(isRebalancer[msg.sender] || msg.sender == owner(), "Not authorized");
        _;
    }

    /**
     * @notice Rebalance zu neuen Tokens, Prozentsätzen und Feeds: Swap alles zu USDC, dann neu allocieren.
     * @param newTokenNames Neue Token-Namen (im MVP nur ["WETH", "cbBTC", "cbXRP"])
     * @param newPercentages Neue Prozentsätze (müssen zu newTokenNames passen)
     * @param poolFeesToUSDC Fee-Tiers für Swaps von alten Tokens zu USDC (müssen zu aktuellen tokens passen)
     * @param minOutsToUSDC Min-Outs für Swaps zu USDC (alte)
     * @param poolFeesFromUSDC Fee-Tiers für Swaps von USDC zu neuen Tokens (müssen zu newTokenNames passen)
     * @param minOutsFromUSDC Min-Outs für Swaps zu neuen Tokens
     */
    function rebalance(
        string[] calldata newTokenNames,
        uint256[] calldata newPercentages,
        uint24[] calldata poolFeesToUSDC,
        uint256[] calldata minOutsToUSDC,
        uint24[] calldata poolFeesFromUSDC,
        uint256[] calldata minOutsFromUSDC
    ) external onlyRebalancer nonReentrant {
        require(newTokenNames.length == newPercentages.length, "New tokens and percentages mismatch");
        require(poolFeesToUSDC.length == tokens.length, "Pool fees to USDC mismatch");
        require(minOutsToUSDC.length == tokens.length, "Min outs to USDC mismatch");
        require(poolFeesFromUSDC.length == newTokenNames.length, "Pool fees from USDC mismatch");
        require(minOutsFromUSDC.length == newTokenNames.length, "Min outs from USDC mismatch");

        uint256 totalPct = 0;
        for (uint256 i = 0; i < newPercentages.length; i++) {
            totalPct += newPercentages[i];
            require(totalPct <= 100, "Total percentages exceed 100");
        }

        // Swap alle alten Tokens zu USDC
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 bal = tokens[i].balanceOf(address(this));
            if (bal > 0) {
                _swapExactInputSingle(address(tokens[i]), address(USDC), poolFeesToUSDC[i], bal, minOutsToUSDC[i]);
            }
        }

        // Update zu neuen Allokationen
        tokens = new IERC20[](newTokenNames.length);
        for (uint256 i = 0; i < newTokenNames.length; i++) {
            string memory name = newTokenNames[i];
            require(address(tokenMap[name]) != address(0), "Invalid token name");
            tokens[i] = tokenMap[name];
        }
        percentages = newPercentages;

        // Neu allokieren
        uint256 usdcBal = USDC.balanceOf(address(this));
        for (uint256 i = 0; i < newTokenNames.length; i++) {
            uint256 toToken = (usdcBal * newPercentages[i]) / 100;
            if (toToken > 0) {
                _swapUSDCfor(tokens[i], toToken, poolFeesFromUSDC[i], minOutsFromUSDC[i]);
            }
        }

        // Gather new balances for event
        uint256[] memory newTokenBals = new uint256[](newTokenNames.length);
        address[] memory newTokenAddrs = new address[](newTokenNames.length);
        for (uint256 i = 0; i < newTokenNames.length; i++) {
            newTokenBals[i] = tokens[i].balanceOf(address(this));
            newTokenAddrs[i] = address(tokens[i]);
        }

        emit Rebalanced(USDC.balanceOf(address(this)), newTokenBals, newPercentages, newTokenAddrs);
    }

    /*─────────────────────  owner: manage rebalancers  ──────────────────────*/
    function addRebalancer(address _rebalancer) external onlyOwner {
        require(_rebalancer != address(0), "Invalid address");
        isRebalancer[_rebalancer] = true;
        emit RebalancerAdded(_rebalancer);
    }

    function removeRebalancer(address _rebalancer) external onlyOwner {
        isRebalancer[_rebalancer] = false;
        emit RebalancerRemoved(_rebalancer);
    }

    /*─────────────────────  view helpers  ─────────────────────────────────*/
    function totalAssets() external view returns (uint256) {
        return _totalAssets();
    }

    function _totalAssets() internal view returns (uint256) {
        uint256 usdcVal = USDC.balanceOf(address(this));  // 6-dec
        uint256 totalVal = usdcVal;

        for (uint256 i = 0; i < tokens.length; i++) {
            AggregatorV3Interface feed = _getFeedForToken(address(tokens[i]));
            (, int256 price,,,) = feed.latestRoundData();  // 8-dec
            uint256 tokenBal = tokens[i].balanceOf(address(this));
            uint256 tokenDec = ERC20(address(tokens[i])).decimals();
            uint256 val = (tokenBal * uint256(price) * USDC_DECIMALS) / (10**tokenDec * 1e8);
            totalVal += val;
        }
        return totalVal;  // 6-dec USDC-equivalent
    }

    function _getFeedForToken(address tokenAddr) internal pure returns (AggregatorV3Interface) {
        if (tokenAddr == address(WETH)) return FEED_ETH_USD;
        if (tokenAddr == address(cbBTC)) return FEED_BTC_USD;
        if (tokenAddr == address(cbXRP)) return FEED_XRP_USD;
        revert("Invalid token");
    }

    function holdings() external view returns (uint256 usdcBal, uint256[] memory tokenBals) {
        tokenBals = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            tokenBals[i] = tokens[i].balanceOf(address(this));
        }
        return (USDC.balanceOf(address(this)), tokenBals);
    }

    function getAllocations() external view returns (uint256[] memory) {
        return percentages;
    }

    function getTokens() external view returns (IERC20[] memory) {
        return tokens;
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