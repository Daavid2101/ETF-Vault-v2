// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ETFVaultV2.sol";

contract VaultFactory {
    address public immutable owner;
    address[] public vaults;

    event VaultCreated(address indexed creator, address vaultAddress, string[] tokenNames, uint256[] percentages);

    constructor() {
        owner = msg.sender;
    }

    function createVault(
    string[] memory _tokenNames,
    uint256[] memory _percentages,
    string memory _name,   // Neu: Übergebe ERC20-Name
    string memory _symbol  // Neu: Übergebe ERC20-Symbol
) external returns (address) {
    address[] memory rebalancers = new address[](1);
    rebalancers[0] = msg.sender;

    ETFVaultV2 newVault = new ETFVaultV2(
        _tokenNames,
        _percentages,
        rebalancers,
        _name,
        _symbol
    );

    vaults.push(address(newVault));

    emit VaultCreated(msg.sender, address(newVault), _tokenNames, _percentages);
    return address(newVault);
}
}