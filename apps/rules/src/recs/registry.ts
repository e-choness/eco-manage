import type { Rule } from './types';
import { evLimitNearCap } from './rules/evLimitNearCap';
import { evOffpeak } from './rules/evOffpeak';
import { hpPrecondition } from './rules/hpPrecondition';
import { peakShaving } from './rules/peakShaving';
import { stormReserve } from './rules/stormReserve';
import { zeroExportLowPrice } from './rules/zeroExportLowPrice';

// The recommendation rules (plan §5), in the order App v2 lists them in Settings → Rules. Each is
// typed with its own parameters; the runner hands every rule the params resolved for its id.
export const RULES = [peakShaving, evOffpeak, evLimitNearCap, hpPrecondition, stormReserve, zeroExportLowPrice] as unknown as Rule[];
