/**
 * Recommendation Model Tests
 *
 * Tests for Recommendation schema validation
 */

import Recommendation from '../../models/Recommendation';

describe('Recommendation Model', () => {
  it('should have userId as a required ObjectId field', () => {
    expect(Recommendation.schema.paths.userId.isRequired).toBeTruthy();
  });

  it('should have title as a required string field', () => {
    expect(Recommendation.schema.paths.title.isRequired).toBeTruthy();
  });

  it('should have description as a required string field', () => {
    expect(Recommendation.schema.paths.description.isRequired).toBeTruthy();
  });

  it('should have priority as a required field', () => {
    expect(Recommendation.schema.paths.priority.isRequired).toBeTruthy();
  });

  it('should have difficulty as a required field', () => {
    expect(Recommendation.schema.paths.difficulty.isRequired).toBeTruthy();
  });

  it('should have category as a required field', () => {
    expect(Recommendation.schema.paths.category.isRequired).toBeTruthy();
  });

  it('should have correct enum values for priority', () => {
    const priorityEnum = (Recommendation.schema.paths.priority as any).enumValues;
    expect(priorityEnum).toContain('high');
    expect(priorityEnum).toContain('medium');
    expect(priorityEnum).toContain('low');
  });

  it('should have correct enum values for difficulty', () => {
    const difficultyEnum = (Recommendation.schema.paths.difficulty as any).enumValues;
    expect(difficultyEnum).toContain('easy');
    expect(difficultyEnum).toContain('medium');
    expect(difficultyEnum).toContain('hard');
  });

  it('should have correct enum values for status', () => {
    const statusEnum = (Recommendation.schema.paths.status as any).enumValues;
    expect(statusEnum).toContain('pending');
    expect(statusEnum).toContain('accepted');
    expect(statusEnum).toContain('dismissed');
  });

  it('should have default status as pending', () => {
    const statusDefault = (Recommendation.schema.paths.status as any).defaultValue;
    expect(statusDefault).toBe('pending');
  });

  it('should have default estimatedSavings as 0', () => {
    const savingsDefault = (Recommendation.schema.paths.estimatedSavings as any).defaultValue;
    expect(savingsDefault).toBe(0);
  });

  it('should have userId reference to User', () => {
    const userIdRef = (Recommendation.schema.paths.userId as any).options.ref;
    expect(userIdRef).toBe('User');
  });

  it('should validate non-negative estimatedSavings', () => {
    const savingsMin = (Recommendation.schema.paths.estimatedSavings as any).options.min;
    expect(savingsMin).toBe(0);
  });

  it('should have userId indexed', () => {
    const indexes = Recommendation.schema.indexes();
    expect(indexes.some(([idx]) => Object.keys(idx).includes('userId'))).toBeTruthy();
  });

  it('should have status indexed for efficient status queries', () => {
    const indexes = Recommendation.schema.indexes();
    expect(indexes.some(([idx]) => Object.keys(idx).includes('status'))).toBeTruthy();
  });

  it('should be a valid Mongoose model', () => {
    expect(Recommendation).toBeDefined();
    expect(Recommendation.schema).toBeDefined();
  });
});
