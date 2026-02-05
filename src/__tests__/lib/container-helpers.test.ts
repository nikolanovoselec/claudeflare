import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getContainerId, waitForContainerHealth, ensureBucketName } from '../../lib/container-helpers';
import type { HealthCheckOptions, HealthData } from '../../lib/container-helpers';

describe('getContainerId', () => {
  it('creates valid container ID from bucket and session', () => {
    expect(getContainerId('mybucket', 'abc12345')).toBe('mybucket-abc12345');
  });

  it('throws on empty sessionId', () => {
    expect(() => getContainerId('bucket', '')).toThrow();
  });

  it('throws on invalid sessionId format', () => {
    expect(() => getContainerId('bucket', 'short')).toThrow(); // too short
    expect(() => getContainerId('bucket', 'UPPERCASE1')).toThrow(); // uppercase
    expect(() => getContainerId('bucket', 'has-dash12')).toThrow(); // special char
  });

  it('accepts valid sessionId formats', () => {
    expect(() => getContainerId('bucket', 'validid1')).not.toThrow();
    expect(() => getContainerId('bucket', 'abcdefgh')).not.toThrow();
    expect(() => getContainerId('bucket', '12345678')).not.toThrow();
  });
});

describe('waitForContainerHealth', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns ok:true with data when health check succeeds on first attempt', async () => {
    const healthData: HealthData = { status: 'healthy', cpu: 10, memory: 50, disk: 30 };
    const mockContainer = {
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify(healthData), { status: 200 })
      ),
    };

    const result = await waitForContainerHealth(mockContainer as any);

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(healthData);
    expect(mockContainer.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries on non-200 response and succeeds eventually', async () => {
    const healthData: HealthData = { status: 'healthy' };
    const mockContainer = {
      fetch: vi.fn()
        .mockResolvedValueOnce(new Response('', { status: 503 }))
        .mockResolvedValueOnce(new Response('', { status: 503 }))
        .mockResolvedValue(new Response(JSON.stringify(healthData), { status: 200 })),
    };

    const options: HealthCheckOptions = { maxAttempts: 5, delayMs: 100 };
    const resultPromise = waitForContainerHealth(mockContainer as any, options);

    // Advance through the delays
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);

    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(healthData);
    expect(mockContainer.fetch).toHaveBeenCalledTimes(3);
  });

  it('retries on fetch error and succeeds eventually', async () => {
    const healthData: HealthData = { status: 'healthy' };
    const mockContainer = {
      fetch: vi.fn()
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValue(new Response(JSON.stringify(healthData), { status: 200 })),
    };

    const options: HealthCheckOptions = { maxAttempts: 3, delayMs: 50 };
    const resultPromise = waitForContainerHealth(mockContainer as any, options);

    await vi.advanceTimersByTimeAsync(50);

    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(mockContainer.fetch).toHaveBeenCalledTimes(2);
  });

  it('returns ok:false when all attempts fail', async () => {
    const mockContainer = {
      fetch: vi.fn().mockResolvedValue(new Response('', { status: 503 })),
    };

    const options: HealthCheckOptions = { maxAttempts: 3, delayMs: 50 };
    const resultPromise = waitForContainerHealth(mockContainer as any, options);

    // Advance through all delays
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(50);

    const result = await resultPromise;

    expect(result.ok).toBe(false);
    expect(result.data).toBeUndefined();
    expect(mockContainer.fetch).toHaveBeenCalledTimes(3);
  });

  it('calls onProgress callback with correct attempt numbers', async () => {
    const mockContainer = {
      fetch: vi.fn()
        .mockResolvedValueOnce(new Response('', { status: 503 }))
        .mockResolvedValueOnce(new Response('', { status: 503 }))
        .mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200 })),
    };

    const onProgress = vi.fn();
    const options: HealthCheckOptions = { maxAttempts: 5, delayMs: 50, onProgress };
    const resultPromise = waitForContainerHealth(mockContainer as any, options);

    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(50);

    await resultPromise;

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenNthCalledWith(1, 1, 5);
    expect(onProgress).toHaveBeenNthCalledWith(2, 2, 5);
    expect(onProgress).toHaveBeenNthCalledWith(3, 3, 5);
  });

  it('uses default values from constants when options not provided', async () => {
    const mockContainer = {
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
      ),
    };

    await waitForContainerHealth(mockContainer as any);

    // Should use default URL
    expect(mockContainer.fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://container/health',
      })
    );
  });
});

describe('ensureBucketName', () => {
  it('resolves when bucket names match', async () => {
    const expectedBucket = 'my-bucket';
    const mockContainer = {
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ bucketName: expectedBucket }), { status: 200 })
      ),
    };

    await expect(ensureBucketName(mockContainer as any, expectedBucket)).resolves.toBeUndefined();
    expect(mockContainer.fetch).toHaveBeenCalledTimes(1);
  });

  it('throws when bucket names do not match', async () => {
    const mockContainer = {
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ bucketName: 'wrong-bucket' }), { status: 200 })
      ),
    };

    await expect(ensureBucketName(mockContainer as any, 'expected-bucket'))
      .rejects.toThrow('Bucket mismatch: expected expected-bucket, got wrong-bucket');
  });

  it('throws when fetch returns non-200 status', async () => {
    const mockContainer = {
      fetch: vi.fn().mockResolvedValue(new Response('', { status: 500 })),
    };

    await expect(ensureBucketName(mockContainer as any, 'my-bucket'))
      .rejects.toThrow('Failed to get container bucket name');
  });

  it('uses correct endpoint URL', async () => {
    const mockContainer = {
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ bucketName: 'bucket' }), { status: 200 })
      ),
    };

    await ensureBucketName(mockContainer as any, 'bucket');

    expect(mockContainer.fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://container/bucket-name',
      })
    );
  });
});
