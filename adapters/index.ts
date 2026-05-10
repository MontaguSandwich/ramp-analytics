import zkp2p from './zkp2p.ts';
import ramp_network from './ramp_network.ts';
import binance_p2p from './binance_p2p.ts';
import kraken_otc from './kraken_otc.ts';
import type { Adapter } from '../lib/types.ts';

export const adapters: Adapter[] = [zkp2p, ramp_network, binance_p2p, kraken_otc];
