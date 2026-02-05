import { Hono } from 'hono';
import type { Env, CredentialsStatus } from '../types';
import { authMiddleware, AuthVariables } from '../middleware/auth';
import { encrypt, decrypt, importKeyFromBase64 } from '../lib/crypto';
import { createLogger } from '../lib/logger';
import { ValidationError, CredentialsError, AuthError } from '../lib/error-types';

const logger = createLogger('credentials');

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

// Use shared auth middleware
app.use('*', authMiddleware);

/**
 * Middleware to gate all credentials routes behind DEV_MODE
 * Credentials API should only be accessible in development for security
 */
app.use('*', async (c, next) => {
  if (c.env.DEV_MODE !== 'true') {
    throw new AuthError('Credentials API only available in DEV_MODE');
  }
  await next();
});

/**
 * Credentials JSON structure expected by Claude Code
 */
interface ClaudeCredentials {
  claudeAiOauth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes: string[];
  };
}

/**
 * Get R2 key for user's credentials file
 * Note: Uses bucketName as userId for consistency with auth middleware
 */
function getCredentialsKey(bucketName: string): string {
  return `users/${bucketName}/.claude/.credentials.json`;
}

/**
 * Get KV key for credential status cache
 */
function getCredentialStatusKey(bucketName: string): string {
  return `credentials:${bucketName}:status`;
}

/**
 * Get encryption key from environment
 * Returns null if encryption is not configured
 */
async function getEncryptionKey(env: Env): Promise<CryptoKey | null> {
  if (!env.ENCRYPTION_KEY) {
    return null;
  }
  try {
    return await importKeyFromBase64(env.ENCRYPTION_KEY);
  } catch (error) {
    logger.error('Failed to import encryption key', error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

/**
 * POST /api/credentials
 * Upload credentials JSON to R2 (encrypted if ENCRYPTION_KEY is set)
 *
 * Body: { claudeAiOauth: { accessToken, refreshToken, expiresAt, scopes } }
 */
app.post('/', async (c) => {
  const reqLogger = logger.child({ requestId: c.req.header('X-Request-ID') });
  const bucketName = c.get('bucketName');

  try {
    const body = await c.req.json<ClaudeCredentials>();

    // Validate credentials structure
    if (!body.claudeAiOauth) {
      throw new ValidationError('Missing claudeAiOauth object');
    }

    const { claudeAiOauth } = body;
    if (!claudeAiOauth.accessToken || !claudeAiOauth.refreshToken) {
      throw new ValidationError('Missing accessToken or refreshToken');
    }

    if (typeof claudeAiOauth.expiresAt !== 'number') {
      throw new ValidationError('expiresAt must be a number (timestamp)');
    }

    if (!Array.isArray(claudeAiOauth.scopes)) {
      throw new ValidationError('scopes must be an array');
    }

    // Get encryption key (optional)
    const encryptionKey = await getEncryptionKey(c.env);

    // Prepare credentials data
    const credentialsJson = JSON.stringify(body, null, 2);

    // Store credentials in R2 (encrypted if key is available)
    const key = getCredentialsKey(bucketName);
    let dataToStore: string;
    let contentType: string;

    if (encryptionKey) {
      // Encrypt the credentials before storing
      dataToStore = await encrypt(credentialsJson, encryptionKey);
      contentType = 'application/octet-stream';
      reqLogger.info('Storing encrypted credentials');
    } else {
      // Store as plain JSON (backwards compatible)
      dataToStore = credentialsJson;
      contentType = 'application/json';
      reqLogger.info('Storing unencrypted credentials (ENCRYPTION_KEY not set)');
    }

    await c.env.STORAGE.put(key, dataToStore, {
      httpMetadata: { contentType },
      customMetadata: { encrypted: encryptionKey ? 'true' : 'false' },
    });

    // Cache credential status in KV
    const status: CredentialsStatus = {
      exists: true,
      expiresAt: claudeAiOauth.expiresAt,
      scopes: claudeAiOauth.scopes,
      updatedAt: new Date().toISOString(),
    };
    await c.env.KV.put(getCredentialStatusKey(bucketName), JSON.stringify(status));

    // Note: Container will pick up new credentials via R2 sync
    // No need to notify container directly - it was causing orphan DOs

    return c.json({
      success: true,
      message: 'Credentials uploaded successfully',
      expiresAt: claudeAiOauth.expiresAt,
      scopes: claudeAiOauth.scopes,
      encrypted: !!encryptionKey,
    }, 201);
  } catch (error) {
    reqLogger.error('Upload error', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new CredentialsError('upload');
  }
});

/**
 * GET /api/credentials
 * Check if credentials exist and get status
 *
 * Does NOT return the actual credentials for security
 */
app.get('/', async (c) => {
  const bucketName = c.get('bucketName');

  try {
    // First check KV cache
    const cachedStatus = await c.env.KV.get<CredentialsStatus>(
      getCredentialStatusKey(bucketName),
      'json'
    );

    if (cachedStatus) {
      const isExpired = Date.now() > cachedStatus.expiresAt;
      return c.json({
        exists: cachedStatus.exists,
        expired: isExpired,
        expiresAt: cachedStatus.expiresAt,
        scopes: cachedStatus.scopes,
        updatedAt: cachedStatus.updatedAt,
      });
    }

    // Fallback: check R2 directly
    const key = getCredentialsKey(bucketName);
    const object = await c.env.STORAGE.head(key);

    if (!object) {
      return c.json({
        exists: false,
        expired: false,
        expiresAt: null,
        scopes: [],
        updatedAt: null,
      });
    }

    // Object exists but no cached status, read and cache it
    const credentialsObject = await c.env.STORAGE.get(key);
    if (credentialsObject) {
      // Get encryption key and check if data is encrypted
      const encryptionKey = await getEncryptionKey(c.env);
      const isEncrypted = object.customMetadata?.encrypted === 'true';

      let credentials: ClaudeCredentials;

      if (isEncrypted && encryptionKey) {
        // Decrypt the credentials
        const encryptedData = await credentialsObject.text();
        const decryptedJson = await decrypt(encryptedData, encryptionKey);
        credentials = JSON.parse(decryptedJson);
      } else if (isEncrypted && !encryptionKey) {
        // Data is encrypted but no key available
        logger.warn('Encrypted credentials found but ENCRYPTION_KEY not set');
        return c.json({
          exists: true,
          expired: false,
          expiresAt: null,
          scopes: [],
          updatedAt: null,
          error: 'Cannot read encrypted credentials',
        });
      } else {
        // Plain JSON
        credentials = await credentialsObject.json<ClaudeCredentials>();
      }

      const status: CredentialsStatus = {
        exists: true,
        expiresAt: credentials.claudeAiOauth.expiresAt,
        scopes: credentials.claudeAiOauth.scopes,
        updatedAt: new Date().toISOString(),
      };
      await c.env.KV.put(getCredentialStatusKey(bucketName), JSON.stringify(status));

      const isExpired = Date.now() > status.expiresAt;
      return c.json({
        exists: true,
        expired: isExpired,
        expiresAt: status.expiresAt,
        scopes: status.scopes,
        updatedAt: status.updatedAt,
      });
    }

    return c.json({
      exists: false,
      expired: false,
      expiresAt: null,
      scopes: [],
      updatedAt: null,
    });
  } catch (error) {
    logger.error('Check error', error instanceof Error ? error : new Error(String(error)));
    throw new CredentialsError('check');
  }
});

/**
 * DELETE /api/credentials
 * Remove credentials from R2
 */
app.delete('/', async (c) => {
  const bucketName = c.get('bucketName');

  try {
    const key = getCredentialsKey(bucketName);

    // Delete from R2
    await c.env.STORAGE.delete(key);

    // Clear KV cache
    await c.env.KV.delete(getCredentialStatusKey(bucketName));

    // Note: Container will pick up credential deletion via R2 sync
    // No need to notify container directly - it was causing orphan DOs

    return c.json({
      success: true,
      message: 'Credentials deleted',
    });
  } catch (error) {
    logger.error('Delete error', error instanceof Error ? error : new Error(String(error)));
    throw new CredentialsError('delete');
  }
});

export default app;
