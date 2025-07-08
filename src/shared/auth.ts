import { z } from 'zod';

// Base auth schema
export const AuthSchema = z.object({
  auth_type: z.enum(['api_key', 'basic', 'oauth2']),
});

// API Key Authentication
export const ApiKeyAuthSchema = AuthSchema.extend({
  auth_type: z.literal('api_key'),
  api_key: z.string(),
  header_name: z.string().default('Authorization'),
  header_value_prefix: z.string().default('Bearer '),
});

// Basic Authentication
export const BasicAuthSchema = AuthSchema.extend({
  auth_type: z.literal('basic'),
  username: z.string(),
  password: z.string(),
});

// OAuth2 Authentication
export const OAuth2AuthSchema = AuthSchema.extend({
  auth_type: z.literal('oauth2'),
  client_id: z.string(),
  client_secret: z.string(),
  token_url: z.string(),
  scope: z.string().optional(),
  grant_type: z.string().default('client_credentials'),
});

// Union type for all auth types
export const AuthUnionSchema = z.discriminatedUnion('auth_type', [
  ApiKeyAuthSchema,
  BasicAuthSchema,
  OAuth2AuthSchema,
]);

// TypeScript types
export type Auth = z.infer<typeof AuthSchema>;
export type ApiKeyAuth = z.infer<typeof ApiKeyAuthSchema>;
export type BasicAuth = z.infer<typeof BasicAuthSchema>;
export type OAuth2Auth = z.infer<typeof OAuth2AuthSchema>;
export type AuthUnion = z.infer<typeof AuthUnionSchema>;
