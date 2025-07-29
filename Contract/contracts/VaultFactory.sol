// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/********************************************************************************************
*                                VaultFactory.sol                                           *
* Deploys minimal‑proxy (EIP‑1167) instances of Vault and initialises them with              *
* the user‑defined target allocation.                                                        *
*********************************************************************************************/

import "@openzeppelin/contracts/proxy/Clones.sol";
import "./Vault.sol";

contract VaultFactory {
    using Clones for address;

    /// @notice Address of the Vault implementation used for cloning.
    address public immutable implementation;

    /// @notice Owner => list of vaults they created
    mapping(address => address[]) public vaultsByOwner;

    /// @notice Emitted when a new vault is created.
    event VaultCreated(address indexed owner, address vault, address[] tokens, uint256[] weights);

    /**
     * @param _implementation Address of a fully‑deployed Vault contract that will
     *                        serve as the implementation for all clones.
     */
    constructor(address _implementation) {
        require(_implementation != address(0), "implementation = 0x0");
        implementation = _implementation;
    }

    /**
     * @dev Deploys a new Vault clone and initialises it.
     * @param tokens   ERC‑20 token addresses (order defines index).
     * @param weights  Target weights in 1e18 precision (must be same length as tokens).
     * @param name_    ERC‑20 name of the vault share token (e.g. "My BTC/ETH/USDC ETF").
     * @param symbol_  ERC‑20 symbol of the vault share token (e.g. "mETF").
     *
     * The caller becomes owner _and_ gets whitelisted as rebalancer automatically.
     */
    function createVault(
        address[] calldata tokens,
        uint256[] calldata weights,
        string calldata name_,
        string calldata symbol_
    ) external returns (address vault) {
        require(tokens.length == weights.length && tokens.length > 1, "len mismatch");

        // Deploy minimal proxy with deterministic salt for predictable address (optional)
        bytes32 salt = keccak256(abi.encode(msg.sender, tokens, weights, name_, symbol_));
        vault = implementation.cloneDeterministic(salt);

        // Initialise vault (reverts on second call)
        Vault(vault).initialize(name_, symbol_, tokens, weights, msg.sender);

        vaultsByOwner[msg.sender].push(vault);
        emit VaultCreated(msg.sender, vault, tokens, weights);
    }

    /// @notice Predicts address of a clone for off‑chain convenience
    function predictVaultAddress(
        address creator,
        address[] calldata tokens,
        uint256[] calldata weights,
        string calldata name_,
        string calldata symbol_
    ) external view returns (address predicted) {
        bytes32 salt = keccak256(abi.encode(creator, tokens, weights, name_, symbol_));
        predicted = implementation.predictDeterministicAddress(salt, address(this));
    }
}