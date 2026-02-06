import { z } from 'zod';

export const SessionSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  lastAccessedAt: z.string(),
  status: z.enum(['stopped', 'initializing', 'running', 'error']).optional(),
});

export const StartupStatusSchema = z.object({
  stage: z.string(),
  progress: z.number(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const UserSchema = z.object({
  email: z.string(),
  authenticated: z.boolean(),
});

