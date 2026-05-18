import zkp2p from './zkp2p.ts';
import ramp_network from './ramp_network.ts';
import binance_p2p from './binance_p2p.ts';
import type { Adapter } from '../lib/types.ts';

// kraken_otc was dropped 2026-05-19 when the OTC category was retired in favor of
// Crypto-friendly RTPNs (Real-time payment networks / neo banks like Revolut). The
// 'otc' Category enum value is gone; the adapter + YAML + snapshot were removed.
export const adapters: Adapter[] = [zkp2p, ramp_network, binance_p2p];
