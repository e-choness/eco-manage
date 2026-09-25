/**
 * Device Model Tests
 *
 * Tests for Device schema validation
 */

import Device from '../../models/Device';

describe('Device Model', () => {
  it('should have userId as a required ObjectId field', () => {
    expect(Device.schema.paths.userId.isRequired).toBeTruthy();
  });

  it('should have name as a required string field', () => {
    expect(Device.schema.paths.name.isRequired).toBeTruthy();
  });

  it('should have type as a required field', () => {
    expect(Device.schema.paths.type.isRequired).toBeTruthy();
  });

  it('should have maxOutput as a required field', () => {
    expect(Device.schema.paths.maxOutput.isRequired).toBeTruthy();
  });

  it('should have correct enum values for type', () => {
    const typeEnum = (Device.schema.paths.type as any).enumValues;
    expect(typeEnum).toContain('solar');
    expect(typeEnum).toContain('wind');
    expect(typeEnum).toContain('battery');
    expect(typeEnum).toContain('grid');
  });

  it('should have correct enum values for status', () => {
    const statusEnum = (Device.schema.paths.status as any).enumValues;
    expect(statusEnum).toContain('online');
    expect(statusEnum).toContain('offline');
    expect(statusEnum).toContain('charging');
    expect(statusEnum).toContain('maintenance');
  });

  it('should have default status as online', () => {
    const statusDefault = (Device.schema.paths.status as any).defaultValue;
    expect(statusDefault).toBe('online');
  });

  it('should have default efficiency as 100', () => {
    const efficiencyDefault = (Device.schema.paths.efficiency as any).defaultValue;
    expect(efficiencyDefault).toBe(100);
  });

  it('should have default currentOutput as 0', () => {
    const outputDefault = (Device.schema.paths.currentOutput as any).defaultValue;
    expect(outputDefault).toBe(0);
  });

  it('should have userId reference to User', () => {
    const userIdRef = (Device.schema.paths.userId as any).options.ref;
    expect(userIdRef).toBe('User');
  });

  it('should validate efficiency range (0-100)', () => {
    const efficiencyMin = (Device.schema.paths.efficiency as any).options.min;
    const efficiencyMax = (Device.schema.paths.efficiency as any).options.max;
    expect(efficiencyMin).toBe(0);
    expect(efficiencyMax).toBe(100);
  });

  it('should validate non-negative currentOutput', () => {
    const currentOutputMin = (Device.schema.paths.currentOutput as any).options.min;
    expect(currentOutputMin).toBe(0);
  });

  it('should validate non-negative maxOutput', () => {
    const maxOutputMin = (Device.schema.paths.maxOutput as any).options.min;
    expect(maxOutputMin).toBe(0);
  });

  it('should have userId indexed', () => {
    const indexes = Device.schema.indexes();
    expect(indexes.some(([idx]) => Object.keys(idx).includes('userId'))).toBeTruthy();
  });

  it('should be a valid Mongoose model', () => {
    expect(Device).toBeDefined();
    expect(Device.schema).toBeDefined();
  });
});
