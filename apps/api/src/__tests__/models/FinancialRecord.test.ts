/**
 * FinancialRecord Model Tests
 *
 * Tests for FinancialRecord schema validation
 */

import FinancialRecord from '../../models/FinancialRecord';

describe('FinancialRecord Model', () => {
  it('should have userId as a required ObjectId field', () => {
    expect(FinancialRecord.schema.paths.userId.isRequired).toBeTruthy();
  });

  it('should have date as a required field', () => {
    expect(FinancialRecord.schema.paths.date.isRequired).toBeTruthy();
  });

  it('should have category as a required field', () => {
    expect(FinancialRecord.schema.paths.category.isRequired).toBeTruthy();
  });

  it('should have default savings as 0', () => {
    const savingsDefault = (FinancialRecord.schema.paths.savings as any).defaultValue;
    expect(savingsDefault).toBe(0);
  });

  it('should have default revenue as 0', () => {
    const revenueDefault = (FinancialRecord.schema.paths.revenue as any).defaultValue;
    expect(revenueDefault).toBe(0);
  });

  it('should have default costs as 0', () => {
    const costsDefault = (FinancialRecord.schema.paths.costs as any).defaultValue;
    expect(costsDefault).toBe(0);
  });

  it('should have userId reference to User', () => {
    const userIdRef = (FinancialRecord.schema.paths.userId as any).options.ref;
    expect(userIdRef).toBe('User');
  });

  it('should validate non-negative savings', () => {
    const savingsMin = (FinancialRecord.schema.paths.savings as any).options.min;
    expect(savingsMin).toBe(0);
  });

  it('should validate non-negative revenue', () => {
    const revenueMin = (FinancialRecord.schema.paths.revenue as any).options.min;
    expect(revenueMin).toBe(0);
  });

  it('should validate non-negative costs', () => {
    const costsMin = (FinancialRecord.schema.paths.costs as any).options.min;
    expect(costsMin).toBe(0);
  });

  it('should have userId indexed', () => {
    const indexes = FinancialRecord.schema.indexes();
    expect(indexes.some(([idx]) => Object.keys(idx).includes('userId'))).toBeTruthy();
  });

  it('should have date indexed', () => {
    const indexes = FinancialRecord.schema.indexes();
    expect(indexes.some(([idx]) => Object.keys(idx).includes('date'))).toBeTruthy();
  });

  it('should be a valid Mongoose model', () => {
    expect(FinancialRecord).toBeDefined();
    expect(FinancialRecord.schema).toBeDefined();
  });
});
