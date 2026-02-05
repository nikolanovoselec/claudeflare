import { describe, it, expect } from 'vitest';
import { isAdminRequest, isBucketNameResponse } from '../../lib/type-guards';

describe('isAdminRequest', () => {
  it('returns true for valid admin request', () => {
    expect(isAdminRequest({ doId: 'abc123' })).toBe(true);
  });

  it('returns false for missing doId', () => {
    expect(isAdminRequest({})).toBe(false);
    expect(isAdminRequest({ otherId: 'abc' })).toBe(false);
  });

  it('returns false for non-string doId', () => {
    expect(isAdminRequest({ doId: 123 })).toBe(false);
    expect(isAdminRequest({ doId: null })).toBe(false);
  });

  it('returns false for non-objects', () => {
    expect(isAdminRequest(null)).toBe(false);
    expect(isAdminRequest(undefined)).toBe(false);
    expect(isAdminRequest('string')).toBe(false);
    expect(isAdminRequest(123)).toBe(false);
  });
});

describe('isBucketNameResponse', () => {
  it('returns true for valid response with string', () => {
    expect(isBucketNameResponse({ bucketName: 'my-bucket' })).toBe(true);
  });

  it('returns true for valid response with null', () => {
    expect(isBucketNameResponse({ bucketName: null })).toBe(true);
  });

  it('returns false for missing bucketName', () => {
    expect(isBucketNameResponse({})).toBe(false);
    expect(isBucketNameResponse({ bucket: 'name' })).toBe(false);
  });

  it('returns false for non-objects', () => {
    expect(isBucketNameResponse(null)).toBe(false);
    expect(isBucketNameResponse(undefined)).toBe(false);
  });
});
