import { describe, it, expect } from 'vitest';
import { createMockSession, createMockUserInfo, createMockTerminalConnection } from './utils/mocks';

describe('Test Infrastructure Smoke Tests', () => {
  describe('Mock Factories', () => {
    it('should create a mock session', () => {
      const session = createMockSession();

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.name).toBe('Test Session');
      expect(session.createdAt).toBeDefined();
      expect(session.lastAccessedAt).toBeDefined();
    });

    it('should create a mock session with overrides', () => {
      const session = createMockSession({
        id: 'custom-id',
        name: 'Custom Session',
      });

      expect(session.id).toBe('custom-id');
      expect(session.name).toBe('Custom Session');
    });

    it('should create a mock user info', () => {
      const userInfo = createMockUserInfo();

      expect(userInfo).toBeDefined();
      expect(userInfo.email).toBe('test@example.com');
      expect(userInfo.authenticated).toBe(true);
      expect(userInfo.bucketName).toBeDefined();
    });

    it('should create a mock terminal connection', () => {
      const connection = createMockTerminalConnection();

      expect(connection).toBeDefined();
      expect(connection.sessionId).toBeDefined();
      expect(connection.terminalId).toBe('1');
      expect(connection.state).toBe('disconnected');
    });
  });

  describe('Browser API Mocks', () => {
    it('should have localStorage mock available', () => {
      localStorage.setItem('test-key', 'test-value');
      expect(localStorage.getItem('test-key')).toBe('test-value');

      localStorage.removeItem('test-key');
      expect(localStorage.getItem('test-key')).toBeNull();
    });

    it('should have WebSocket mock available', () => {
      const ws = new WebSocket('ws://localhost/test');
      expect(ws).toBeDefined();
      expect(ws.url).toBe('ws://localhost/test');
    });

    it('should have ResizeObserver mock available', () => {
      const callback = () => {};
      const observer = new ResizeObserver(callback);
      expect(observer).toBeDefined();
      expect(typeof observer.observe).toBe('function');
      expect(typeof observer.unobserve).toBe('function');
      expect(typeof observer.disconnect).toBe('function');
    });
  });

  describe('Vitest Configuration', () => {
    it('should have globals available', () => {
      // These are provided by globals: true in vitest config
      expect(typeof describe).toBe('function');
      expect(typeof it).toBe('function');
      expect(typeof expect).toBe('function');
    });

    it('should have jest-dom matchers available', () => {
      const div = document.createElement('div');
      div.textContent = 'Hello';
      document.body.appendChild(div);

      expect(div).toBeInTheDocument();
      expect(div).toHaveTextContent('Hello');

      document.body.removeChild(div);
    });
  });
});
