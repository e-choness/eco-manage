# 001 — Most `__tests__/routes/*` tests never exercise a route

Found: 2026-09-24, during P0-04.

## What
`alertRoutes`, `analyticsRoutes`, `dashboardRoutes`, `deviceRoutes`, `financialRoutes` and
`optimizationRoutes` tests mock a model and then call that same mock directly, for example:

```ts
mockAlert.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(mockAlerts) });
const result = await Alert.find({ userId }).sort({ timestamp: -1 });
expect(result).toHaveLength(2);
```

No router, controller or service is loaded, so these tests pass whatever the API does. The
`models/*.test.ts` files test mongoose schema definitions only.

## Impact
About 130 of the ~300 API tests give no protection. They passed unchanged through the P0-04
restructure because they don't touch the code that moved.

## Now covered by
`apps/api/src/__tests__/routes.contract.test.ts` (added in P0-04) drives every v1 endpoint
through `createApp()`. It passed against both the pre- and post-refactor code.

## Suggested fix
Delete the tautological files, or fold anything useful into the contract suite. The plan's
§6 contract tests (zod request/response + role matrix) replace them per module in Phase 1+.
