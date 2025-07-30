// src/wagmi-config.js
// src/rainbowkit-config.js (New file for RainbowKit and Wagmi config)
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';

export const config = createConfig({
  chains: [base],
  transports: {
    [base.id]: http('https://base-mainnet.g.alchemy.com/v2/X-3L4dHRc7LCaTFfloRpl'), // Or your Alchemy/Infura RPC URL
  },
});

export const queryClient = new QueryClient();
