import type { ExportView, HistoryRes, HistorySeries, HistoryTotalsResponse, ReportCreate, ReportView } from '@ecomanage/shared';
import api, { call } from './api';

// Description: History chart buckets for a range of local dates
// Endpoint: GET /api/history/series?from&to&res
export const getSeries = (from: string, to: string, res: HistoryRes | 'auto'): Promise<HistorySeries> =>
  call(api.get('/api/history/series', { params: { from, to, res } }));

// Description: Totals for a range and the range it is compared with
// Endpoint: GET /api/history/totals?from&to&compare
export const getTotals = (from: string, to: string, compare: 'none' | 'prev' | 'yoy'): Promise<HistoryTotalsResponse> =>
  call(api.get('/api/history/totals', { params: { from, to, compare } }));

// Description: Ask the worker for a CSV of every 15-min interval in a range
// Endpoint: POST /api/exports
export const createExport = (from: string, to: string): Promise<ExportView> => call(api.post('/api/exports', { from, to }));

// Endpoint: GET /api/exports/:id
export const getExport = (id: string): Promise<ExportView> => call(api.get(`/api/exports/${id}`));

// Endpoint: GET /api/reports
export const getReports = (): Promise<{ items: ReportView[] }> => call(api.get('/api/reports'));

// Endpoint: POST /api/reports
export const createReport = (body: Omit<ReportCreate, 'recipients' | 'notes'> & { recipients: string[]; notes: string }): Promise<ReportView> =>
  call(api.post('/api/reports', body));

// Endpoint: DELETE /api/reports/:id
export const deleteReport = (id: string): Promise<unknown> => call(api.delete(`/api/reports/${id}`));
