import { describe, it, expect } from 'vitest';
import {
  TERMINAL_SERVER_PORT,
  HEALTH_SERVER_PORT,
  SESSION_ID_PATTERN,
  MAX_HEALTH_CHECK_ATTEMPTS,
  HEALTH_CHECK_INTERVAL_MS,
  TERMINAL_REFRESH_DELAY_MS,
  DEFAULT_ALLOWED_ORIGINS,
} from '../../lib/constants';

describe('constants', () => {
  it('exports port constants', () => {
    expect(TERMINAL_SERVER_PORT).toBe(8080);
    expect(HEALTH_SERVER_PORT).toBe(8080); // Consolidated into terminal server
  });

  it('exports session ID validation pattern', () => {
    expect(SESSION_ID_PATTERN).toBeInstanceOf(RegExp);
  });

  it('SESSION_ID_PATTERN validates correctly', () => {
    expect(SESSION_ID_PATTERN.test('abc12345')).toBe(true);
    expect(SESSION_ID_PATTERN.test('validid123')).toBe(true);
    expect(SESSION_ID_PATTERN.test('short')).toBe(false); // too short
    expect(SESSION_ID_PATTERN.test('UPPERCASE')).toBe(false); // uppercase not allowed
    expect(SESSION_ID_PATTERN.test('has-dash')).toBe(false); // special chars
  });

  it('exports retry/polling constants', () => {
    expect(MAX_HEALTH_CHECK_ATTEMPTS).toBe(30);
    expect(HEALTH_CHECK_INTERVAL_MS).toBe(1000);
  });

  it('exports terminal refresh delay', () => {
    expect(TERMINAL_REFRESH_DELAY_MS).toBe(150);
  });

  it('exports default allowed origins', () => {
    expect(DEFAULT_ALLOWED_ORIGINS).toContain('.workers.dev');
  });
});
