/**
 * Alert Model Tests
 *
 * Tests for Alert schema validation
 */

import Alert from '../../models/Alert';

describe('Alert Model', () => {
  it('should have userId as a required ObjectId field', () => {
    expect(Alert.schema.paths.userId.isRequired).toBeTruthy();
  });

  it('should have title as a required string field', () => {
    expect(Alert.schema.paths.title.isRequired).toBeTruthy();
  });

  it('should have message as a required string field', () => {
    expect(Alert.schema.paths.message.isRequired).toBeTruthy();
  });

  it('should have type as a required field', () => {
    expect(Alert.schema.paths.type.isRequired).toBeTruthy();
  });

  it('should have correct enum values for type', () => {
    const typeEnum = (Alert.schema.paths.type as any).enumValues;
    expect(typeEnum).toContain('critical');
    expect(typeEnum).toContain('warning');
    expect(typeEnum).toContain('info');
  });

  it('should have default read as false', () => {
    const readDefault = (Alert.schema.paths.read as any).defaultValue;
    expect(readDefault).toBe(false);
  });

  it('should have default resolved as false', () => {
    const resolvedDefault = (Alert.schema.paths.resolved as any).defaultValue;
    expect(resolvedDefault).toBe(false);
  });

  it('should have timestamp default as Date.now', () => {
    const timestampDefault = (Alert.schema.paths.timestamp as any).defaultValue;
    expect(typeof timestampDefault).toBe('function');
  });

  it('should have userId reference to User', () => {
    const userIdRef = (Alert.schema.paths.userId as any).options.ref;
    expect(userIdRef).toBe('User');
  });

  it('should have userId indexed', () => {
    const indexes = Alert.schema.indexes();
    expect(indexes.some(([idx]) => Object.keys(idx).includes('userId'))).toBeTruthy();
  });

  it('should have timestamp indexed', () => {
    const indexes = Alert.schema.indexes();
    expect(indexes.some(([idx]) => Object.keys(idx).includes('timestamp'))).toBeTruthy();
  });

  it('should be a valid Mongoose model', () => {
    expect(Alert).toBeDefined();
    expect(Alert.schema).toBeDefined();
  });
});
