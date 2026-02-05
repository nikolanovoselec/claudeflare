import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getR2Config } from '../../lib/r2-config';

// Mock KV helper (same pattern as setup.test.ts)
function createMockKV() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) || null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    list: vi.fn(async () => ({ keys: [] })),
    _store: store,
    _clear: () => store.clear(),
  };
}

describe('getR2Config', () => {
  let mockKV: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    mockKV = createMockKV();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function createEnv(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      KV: mockKV as unknown as KVNamespace,
      ...overrides,
    } as any;
  }

  it('returns env values when R2_ACCOUNT_ID and R2_ENDPOINT are set', async () => {
    const env = createEnv({
      R2_ACCOUNT_ID: 'test-account-id',
      R2_ENDPOINT: 'https://test-account-id.r2.cloudflarestorage.com',
    });
    const config = await getR2Config(env);
    expect(config.accountId).toBe('test-account-id');
    expect(config.endpoint).toBe('https://test-account-id.r2.cloudflarestorage.com');
  });

  it('falls back to KV setup:account_id when env vars are empty strings', async () => {
    mockKV._store.set('setup:account_id', 'kv-account-id');
    const env = createEnv({ R2_ACCOUNT_ID: '', R2_ENDPOINT: '' });
    const config = await getR2Config(env);
    expect(config.accountId).toBe('kv-account-id');
    expect(config.endpoint).toBe('https://kv-account-id.r2.cloudflarestorage.com');
  });

  it('falls back to KV when env vars are undefined', async () => {
    mockKV._store.set('setup:account_id', 'kv-account-id');
    const env = createEnv({});
    const config = await getR2Config(env);
    expect(config.accountId).toBe('kv-account-id');
    expect(config.endpoint).toBe('https://kv-account-id.r2.cloudflarestorage.com');
  });

  it('computes R2_ENDPOINT from account ID', async () => {
    const env = createEnv({ R2_ACCOUNT_ID: 'abc123' });
    const config = await getR2Config(env);
    expect(config.endpoint).toBe('https://abc123.r2.cloudflarestorage.com');
  });

  it('throws when neither env nor KV has account ID', async () => {
    const env = createEnv({});
    await expect(getR2Config(env)).rejects.toThrow();
  });

  it('prefers env over KV when both exist', async () => {
    mockKV._store.set('setup:account_id', 'kv-account-id');
    const env = createEnv({ R2_ACCOUNT_ID: 'env-account-id' });
    const config = await getR2Config(env);
    expect(config.accountId).toBe('env-account-id');
  });

  it('works with only account ID in KV (endpoint computed)', async () => {
    mockKV._store.set('setup:account_id', 'from-kv');
    const env = createEnv({});
    const config = await getR2Config(env);
    expect(config.accountId).toBe('from-kv');
    expect(config.endpoint).toBe('https://from-kv.r2.cloudflarestorage.com');
  });

  it('uses R2_ENDPOINT from env when provided alongside R2_ACCOUNT_ID', async () => {
    const env = createEnv({
      R2_ACCOUNT_ID: 'test-id',
      R2_ENDPOINT: 'https://custom-endpoint.example.com',
    });
    const config = await getR2Config(env);
    expect(config.endpoint).toBe('https://custom-endpoint.example.com');
  });

  it('does not call KV when env values are present', async () => {
    const env = createEnv({
      R2_ACCOUNT_ID: 'env-id',
      R2_ENDPOINT: 'https://env-id.r2.cloudflarestorage.com',
    });
    await getR2Config(env);
    expect(mockKV.get).not.toHaveBeenCalled();
  });

  it('throws descriptive error message', async () => {
    const env = createEnv({});
    await expect(getR2Config(env)).rejects.toThrow(/R2 account ID/i);
  });
});
