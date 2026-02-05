#!/usr/bin/env node
/**
 * Deploy script for environments without Docker (e.g., Workers Builds).
 *
 * Problem: wrangler deploy with [[containers]] config tries to build Docker image.
 * Solution: Temporarily strip container AND Durable Object config, deploy, restore.
 *
 * WHY we strip the Durable Object config:
 * - If we deploy with [[durable_objects.bindings]] but without containers,
 *   Cloudflare creates the DO class WITHOUT container support.
 * - Once a DO class exists without container support, it CANNOT be upgraded
 *   to use containers later. Attempting to add [[containers]] to an existing
 *   non-container DO class causes: DURABLE_OBJECT_NOT_CONTAINER_ENABLED
 * - By stripping the DO config entirely, Workers Builds creates a worker
 *   with NO Durable Object at all.
 * - The first GitHub Actions deploy (with Docker) then creates the DO class
 *   fresh WITH container support, avoiding the error.
 *
 * For full deploys WITH container image, use: npm run deploy:docker
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const TOML_PATH = 'wrangler.toml';
const original = readFileSync(TOML_PATH, 'utf8');

// Strip sections that require Docker or would create non-container DOs:
// 1. Container configuration (# Container configuration ... before next section)
// 2. Durable Objects binding (# Durable Objects ... [[durable_objects.bindings]])
// 3. Migrations ([[migrations]] sections)
const lines = original.split('\n');
const filtered = [];
let skipping = false;
let skipReason = '';

for (const line of lines) {
  // Start skipping: Container configuration section
  if (line.startsWith('# Container configuration')) {
    skipping = true;
    skipReason = 'container';
    continue;
  }

  // Start skipping: Durable Objects section
  if (line.startsWith('# Durable Objects')) {
    skipping = true;
    skipReason = 'durable-objects';
    continue;
  }

  // Start skipping: Migrations section
  if (line.startsWith('# Migrations') || line.startsWith('[[migrations]]')) {
    skipping = true;
    skipReason = 'migrations';
    continue;
  }

  // Stop skipping: Known section headers that mark end of stripped sections
  const endMarkers = [
    '# Static assets',
    '# Enable container',
    '# Environment variables',
    '# KV namespace',
    '# Claudeflare',
    '[observability]',
    '[vars]',
    '[[kv_namespaces]]',
    '[assets]',
  ];
  if (skipping && endMarkers.some(marker => line.startsWith(marker))) {
    skipping = false;
    skipReason = '';
  }

  // Keep skipping migration content (tag, new_sqlite_classes, deleted_classes, etc.)
  if (skipping && skipReason === 'migrations') {
    // Continue skipping until we hit a new section header
    if (line.startsWith('# ') || line.startsWith('[[') && !line.startsWith('[[migrations]]')) {
      skipping = false;
      skipReason = '';
    } else {
      continue;
    }
  }

  // Skip [[durable_objects.bindings]] lines when in DO section
  if (skipping && skipReason === 'durable-objects') {
    if (line.startsWith('[[durable_objects')) {
      continue;
    }
    // Skip property lines (name = ..., class_name = ...)
    if (line.match(/^\s*\w+\s*=/)) {
      continue;
    }
    // Empty line - keep skipping
    if (line.trim() === '') {
      continue;
    }
  }

  // Skip ALL lines when in container or durable-objects mode (except when we just stopped)
  if (skipping && (skipReason === 'container' || skipReason === 'durable-objects')) {
    continue;
  }

  if (!skipping) {
    filtered.push(line);
  }
}

const stripped = filtered.join('\n');

try {
  console.log('Deploying without container image (no Docker available)...');
  console.log('Stripped: [[containers]], [[durable_objects.bindings]], [[migrations]]');
  writeFileSync(TOML_PATH, stripped);
  execSync('npx wrangler deploy', { stdio: 'inherit' });
  console.log('Deploy complete.');
  console.log('NOTE: Container image requires GitHub Actions with Docker.');
  console.log('      First GH Actions deploy will create DO class with container support.');
} finally {
  // Always restore original wrangler.toml
  writeFileSync(TOML_PATH, original);
}
