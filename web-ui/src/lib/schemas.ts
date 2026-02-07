import { z } from 'zod';

// Shared base schema for session objects (used by response schemas below)
export const SessionSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  lastAccessedAt: z.string(),
  status: z.enum(['stopped', 'initializing', 'running', 'error']).optional(),
});

// Response schemas for API endpoints — these are the strict, runtime-validated schemas.
// Previously duplicated in client.ts (strict) and here (loose). Now consolidated as the single source of truth.

export const UserResponseSchema = z.object({
  email: z.string(),
  authenticated: z.boolean(),
  bucketName: z.string(),
  bucketCreated: z.boolean().optional(),
  role: z.enum(['admin', 'user']).optional(),
});

export const SessionsResponseSchema = z.object({
  sessions: z.array(SessionSchema),
});

export const CreateSessionResponseSchema = z.object({
  session: SessionSchema,
});

// InitStage enum values from types.ts
export const InitStageSchema = z.enum(['creating', 'starting', 'syncing', 'mounting', 'verifying', 'ready', 'error', 'stopped']);

export const StartupStatusResponseSchema = z.object({
  stage: InitStageSchema,
  progress: z.number(),
  message: z.string(),
  details: z.object({
    bucketName: z.string(),
    container: z.string(),
    path: z.string(),
    email: z.string().optional(),
    containerStatus: z.string().optional(),
    syncStatus: z.string().optional(),
    syncError: z.string().nullable().optional(),
    terminalPid: z.number().optional(),
    healthServerOk: z.boolean().optional(),
    terminalServerOk: z.boolean().optional(),
    cpu: z.string().optional(),
    mem: z.string().optional(),
    hdd: z.string().optional(),
  }),
  error: z.string().optional(),
});

// Session status response schema
export const SessionStatusResponseSchema = z.object({
  status: z.string(),
  ptyActive: z.boolean().optional(),
});

// Batch session status response schema
export const BatchSessionStatusResponseSchema = z.object({
  statuses: z.record(z.string(), z.object({
    status: z.string(),
    ptyActive: z.boolean(),
  })),
});


