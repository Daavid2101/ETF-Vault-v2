// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ETFVaultV2.sol";

contract VaultFactory {
    address public immutable owner;

    event VaultCreated(address indexed creator, address vaultAddress, string[] tokenNames, uint256[] percentages);

    constructor() {
        owner = msg.sender;
    }

    function createVault(
        string[] memory _tokenNames,
        uint256[] memory _percentages
    ) external returns (address) {
        // Deploy a new ETFVaultV2 instance
        address[] memory rebalancers = new address[](1);
        rebalancers[0] = msg.sender;
        ETFVaultV2 newVault = new ETFVaultV2(
            _tokenNames,
            _percentages,
            rebalancers // Creator as the initial rebalancer
        );

        emit VaultCreated(msg.sender, address(newVault), _tokenNames, _percentages);
        return address(newVault);
    }
}