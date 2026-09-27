import type { BillDetail, BillsResponse, RangeSpend, UtilityBillView } from '@ecomanage/shared';
import api, { errorMessage } from './api';

const call = async <T>(p: Promise<{ data: T }>): Promise<T> => {
  try {
    return (await p).data;
  } catch (error) {
    throw new Error(errorMessage(error), { cause: error });
  }
};

// Description: Every bill, newest first, with the Bills KPIs (owner, manager)
// Endpoint: GET /api/bills
export const getBills = (): Promise<BillsResponse> => call(api.get('/api/bills'));

// Description: One billing period with its lines, tariff, estimated stretches and savings
// Endpoint: GET /api/bills/:period
export const getBill = (period: string): Promise<BillDetail> => call(api.get(`/api/bills/${period}`));

// Description: Energy spending for any local date range, each day on its tariff version
// Endpoint: GET /api/bills/range?from&to
export const getRangeSpend = (from: string, to: string): Promise<RangeSpend> => call(api.get('/api/bills/range', { params: { from, to } }));

// Description: The utility's bill for a closed period: a PDF or CSV read by the worker (owner)
// Endpoint: POST /api/bills/:period/utility-bill (multipart `file`)
export const uploadUtilityBill = (period: string, file: File): Promise<{ utility: UtilityBillView }> => {
  const form = new FormData();
  form.append('file', file);
  return call(api.post(`/api/bills/${period}/utility-bill`, form, { headers: { 'Content-Type': 'multipart/form-data' } }));
};

// Description: The utility's total typed in instead of uploading the bill (owner)
// Endpoint: POST /api/bills/:period/utility-bill { totalCents }
export const enterUtilityTotal = (period: string, totalCents: number): Promise<{ utility: UtilityBillView }> =>
  call(api.post(`/api/bills/${period}/utility-bill`, { totalCents }));
