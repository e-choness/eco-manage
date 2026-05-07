/**
 * EnergyReading Model Tests
 *
 * Tests for EnergyReading schema validation
 */

import EnergyReading from '../../models/EnergyReading';

describe('EnergyReading Model', () => {
  it('should have deviceId as a required ObjectId field', () => {
    expect(EnergyReading.schema.paths.deviceId.isRequired).toBeTruthy();
  });

  it('should have userId as a required ObjectId field', () => {
    expect(EnergyReading.schema.paths.userId.isRequired).toBeTruthy();
  });

  it('should have timestamp as a required field', () => {
    expect(EnergyReading.schema.paths.timestamp.isRequired).toBeTruthy();
  });

  it('should have value as a required field', () => {
    expect(EnergyReading.schema.paths.value.isRequired).toBeTruthy();
  });

  it('should have type as a required field', () => {
    expect(EnergyReading.schema.paths.type.isRequired).toBeTruthy();
  });

  it('should have correct enum values for type', () => {
    const typeEnum = (EnergyReading.schema.paths.type as any).enumValues;
    expect(typeEnum).toContain('production');
    expect(typeEnum).toContain('consumption');
  });

  it('should have deviceId reference to Device', () => {
    const deviceIdRef = (EnergyReading.schema.paths.deviceId as any).options.ref;
    expect(deviceIdRef).toBe('Device');
  });

  it('should have userId reference to User', () => {
    const userIdRef = (EnergyReading.schema.paths.userId as any).options.ref;
    expect(userIdRef).toBe('User');
  });

  it('should validate non-negative value', () => {
    const valueMin = (EnergyReading.schema.paths.value as any).options.min;
    expect(valueMin).toBe(0);
  });

  it('should have deviceId indexed', () => {
    const indexes = EnergyReading.schema.indexes();
    expect(indexes.some(([idx]) => Object.keys(idx).includes('deviceId'))).toBeTruthy();
  });

  it('should have userId indexed', () => {
    const indexes = EnergyReading.schema.indexes();
    expect(indexes.some(([idx]) => Object.keys(idx).includes('userId'))).toBeTruthy();
  });

  it('should have timestamp indexed', () => {
    const indexes = EnergyReading.schema.indexes();
    expect(indexes.some(([idx]) => Object.keys(idx).includes('timestamp'))).toBeTruthy();
  });

  it('should be a valid Mongoose model', () => {
    expect(EnergyReading).toBeDefined();
    expect(EnergyReading.schema).toBeDefined();
  });
});
