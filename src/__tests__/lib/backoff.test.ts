import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withBackoff, MaxRetriesExceededError, BackoffOptions } from '../../lib/backoff';

describe('withBackoff', () => {
  // Use very short delays for testing
  const fastOptions: BackoffOptions = {
    initialDelayMs: 1,
    maxDelayMs: 10,
    factor: 2,
    maxAttempts: 5,
  };

  describe('successful execution', () => {
    it('returns result on first successful attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await withBackoff(fn, fastOptions);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('returns result after retries', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success');

      const result = await withBackoff(fn, fastOptions);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('failure handling', () => {
    it('throws MaxRetriesExceededError after max attempts', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('always fails'));

      await expect(
        withBackoff(fn, { ...fastOptions, maxAttempts: 3 })
      ).rejects.toThrow(MaxRetriesExceededError);

      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('MaxRetriesExceededError includes attempt count', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      try {
        await withBackoff(fn, { ...fastOptions, maxAttempts: 4 });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(MaxRetriesExceededError);
        expect((err as MaxRetriesExceededError).attempts).toBe(4);
      }
    });

    it('MaxRetriesExceededError includes last error', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('specific error'));

      try {
        await withBackoff(fn, { ...fastOptions, maxAttempts: 2 });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(MaxRetriesExceededError);
        expect((err as MaxRetriesExceededError).lastError.message).toBe('specific error');
      }
    });

    it('converts non-Error throws to Error', async () => {
      const fn = vi.fn().mockRejectedValue('string error');

      try {
        await withBackoff(fn, { ...fastOptions, maxAttempts: 1 });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(MaxRetriesExceededError);
        expect((err as MaxRetriesExceededError).lastError.message).toBe('string error');
      }
    });
  });

  describe('delay behavior', () => {
    it('uses exponential delay progression', async () => {
      const delays: number[] = [];
      const originalSetTimeout = globalThis.setTimeout;

      // Monkey-patch setTimeout to capture delays
      globalThis.setTimeout = ((fn: () => void, delay: number) => {
        delays.push(delay);
        return originalSetTimeout(fn, 1); // Use 1ms for actual test speed
      }) as typeof setTimeout;

      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      try {
        await withBackoff(fn, {
          initialDelayMs: 100,
          maxDelayMs: 10000,
          factor: 2,
          maxAttempts: 5,
          jitter: false,
        });

        // Check delays: 100, 200, 400
        expect(delays[0]).toBe(100);
        expect(delays[1]).toBe(200);
        expect(delays[2]).toBe(400);
      } finally {
        globalThis.setTimeout = originalSetTimeout;
      }
    });

    it('respects maxDelayMs cap', async () => {
      const delays: number[] = [];
      const originalSetTimeout = globalThis.setTimeout;

      globalThis.setTimeout = ((fn: () => void, delay: number) => {
        delays.push(delay);
        return originalSetTimeout(fn, 1);
      }) as typeof setTimeout;

      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      try {
        await withBackoff(fn, {
          initialDelayMs: 100,
          maxDelayMs: 300, // Cap at 300
          factor: 2,
          maxAttempts: 5,
          jitter: false,
        });

        // Delays should be: 100, 200, 300, 300 (capped)
        expect(delays[0]).toBe(100);
        expect(delays[1]).toBe(200);
        expect(delays[2]).toBe(300);
        expect(delays[3]).toBe(300);
      } finally {
        globalThis.setTimeout = originalSetTimeout;
      }
    });
  });

  describe('jitter', () => {
    it('applies jitter when enabled', async () => {
      const delays: number[] = [];
      const originalSetTimeout = globalThis.setTimeout;
      const originalRandom = Math.random;

      Math.random = () => 0.5;
      globalThis.setTimeout = ((fn: () => void, delay: number) => {
        delays.push(delay);
        return originalSetTimeout(fn, 1);
      }) as typeof setTimeout;

      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      try {
        await withBackoff(fn, {
          initialDelayMs: 100,
          maxDelayMs: 1000,
          factor: 2,
          maxAttempts: 3,
          jitter: true,
        });

        // With jitter and random = 0.5: delay = 100 * (0.5 + 0.5) = 100
        expect(delays[0]).toBe(100);
      } finally {
        globalThis.setTimeout = originalSetTimeout;
        Math.random = originalRandom;
      }
    });

    it('jitter ranges from 50% to 150%', async () => {
      const originalSetTimeout = globalThis.setTimeout;
      const originalRandom = Math.random;

      // Test min jitter (random = 0)
      let capturedDelay = 0;
      Math.random = () => 0;
      globalThis.setTimeout = ((fn: () => void, delay: number) => {
        capturedDelay = delay;
        return originalSetTimeout(fn, 1);
      }) as typeof setTimeout;

      const fn1 = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      try {
        await withBackoff(fn1, {
          initialDelayMs: 100,
          maxDelayMs: 1000,
          factor: 2,
          maxAttempts: 3,
          jitter: true,
        });

        expect(capturedDelay).toBe(50); // 100 * 0.5
      } finally {
        Math.random = originalRandom;
        globalThis.setTimeout = originalSetTimeout;
      }

      // Test max jitter (random = 1)
      Math.random = () => 1;
      globalThis.setTimeout = ((fn: () => void, delay: number) => {
        capturedDelay = delay;
        return originalSetTimeout(fn, 1);
      }) as typeof setTimeout;

      const fn2 = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      try {
        await withBackoff(fn2, {
          initialDelayMs: 100,
          maxDelayMs: 1000,
          factor: 2,
          maxAttempts: 3,
          jitter: true,
        });

        expect(capturedDelay).toBe(150); // 100 * 1.5
      } finally {
        Math.random = originalRandom;
        globalThis.setTimeout = originalSetTimeout;
      }
    });
  });

  describe('edge cases', () => {
    it('handles single attempt', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      await expect(
        withBackoff(fn, { ...fastOptions, maxAttempts: 1 })
      ).rejects.toThrow(MaxRetriesExceededError);

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('succeeds on last attempt', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const result = await withBackoff(fn, { ...fastOptions, maxAttempts: 3 });
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('preserves return type', async () => {
      interface MyResult {
        id: number;
        name: string;
      }

      const fn = vi.fn().mockResolvedValue({ id: 1, name: 'test' });

      const result: MyResult = await withBackoff(fn, fastOptions);
      expect(result).toEqual({ id: 1, name: 'test' });
    });
  });
});

describe('MaxRetriesExceededError', () => {
  it('has correct name', () => {
    const err = new MaxRetriesExceededError(3, new Error('test'));
    expect(err.name).toBe('MaxRetriesExceededError');
  });

  it('has correct message', () => {
    const err = new MaxRetriesExceededError(5, new Error('test'));
    expect(err.message).toBe('Max retries (5) exceeded');
  });

  it('is instanceof Error', () => {
    const err = new MaxRetriesExceededError(3, new Error('test'));
    expect(err).toBeInstanceOf(Error);
  });

  it('exposes attempts and lastError', () => {
    const lastError = new Error('original');
    const err = new MaxRetriesExceededError(7, lastError);
    expect(err.attempts).toBe(7);
    expect(err.lastError).toBe(lastError);
  });
});
