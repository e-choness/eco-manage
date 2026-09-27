// Bills (P2-03 to P2-05; the Bills screen, P4-06). Money is whole cents; `period` is YYYY-MM, the
// month the billing period starts in; `start` and `end` are UTC instants (end exclusive).

export interface BillLines {
  energyPkCents: number;
  energyMdCents: number;
  energyOpCents: number;
  demandCents: number;
  fixedCents: number;
  exportCreditCents: number;
}

export interface UtilityBillView {
  status: 'processing' | 'done' | 'failed' | 'manual';
  totalCents: number | null;
  diffCents: number | null; // ours − utility
  source: 'pdf' | 'csv' | 'manual' | null;
  fileName: string | null;
  error: string | null;
  parsedAt: string | null;
}

export interface BillSummary {
  period: string;
  start: string;
  end: string;
  inProgress: boolean;
  days: { elapsed: number; total: number };
  totalCents: number;
  projectedCents: number | null; // open period only
  lines: BillLines;
  peakKw: number;
  peakAt: string | null;
  savedCents: number | null;
  estimatedShare: number;
  utility: UtilityBillView | null;
}

export interface BillsResponse {
  items: BillSummary[]; // newest first
  kpis: {
    last12: { totalCents: number; from: string; to: string } | null;
    saved12Cents: number | null;
    peak12: { kw: number; period: string; demandCents: number } | null;
    utilityDiffPct: number | null;
    compared: number;
  };
}

export interface BillDetail extends BillSummary {
  energyKwh: { pk: number; md: number; op: number; export: number };
  gridKwh: number;
  tariff: { version: number; name: string; demandRateCents: number; fixedCents: number } | null;
  tariffVersions: number[];
  intervals: number;
  unpricedIntervals: number;
  estimated: { start: string; end: string }[];
  savings: { baselineCents: number; solarCents: number; batteryCents: number; demandCents: number; baselinePeakKw: number } | null;
  computedAt: string | null;
}

export interface RangeSpend {
  from: string;
  to: string;
  days: number;
  energyCents: number;
  lines: Pick<BillLines, 'energyPkCents' | 'energyMdCents' | 'energyOpCents'>;
  exportCreditCents: number;
  gridKwh: number;
  exportKwh: number;
  peak: { kw: number; at: string } | null;
  tariffVersions: number[];
  intervals: number;
  estimatedShare: number;
  unpricedIntervals: number;
}
