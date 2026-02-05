import { z } from 'zod';

export const SessionSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  lastAccessedAt: z.string(),
  status: z.enum(['stopped', 'starting', 'running', 'error']).optional(),
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

// Export types derived from schemas
export type SessionFromSchema = z.infer<typeof SessionSchema>;
export type StartupStatusFromSchema = z.infer<typeof StartupStatusSchema>;
export type UserFromSchema = z.infer<typeof UserSchema>;
