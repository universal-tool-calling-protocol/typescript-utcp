import { z } from 'zod';

/**
 * Authentication using an API key.
 * 
 * The key can be provided directly or sourced from an environment variable.
 */
export const ApiKeyAuthSchema = z.object({
  auth_type: z.literal('api_key'),
  api_key: z.string().describe('The API key for authentication.'),
  var_name: z.string().describe('The name of the header, query parameter, cookie or other container for the API key.'),
  location: z.enum(['header', 'query', 'cookie']).default('header').describe('Where to include the API key (header, query parameter, or cookie).'),
});

export type ApiKeyAuth = z.infer<typeof ApiKeyAuthSchema>;

/**
 * Authentication using a username and password.
 */
export const BasicAuthSchema = z.object({
  auth_type: z.literal('basic'),
  username: z.string().describe('The username for basic authentication.'),
  password: z.string().describe('The password for basic authentication.'),
});

export type BasicAuth = z.infer<typeof BasicAuthSchema>;

/**
 * Authentication using OAuth2.
 */
export const OAuth2AuthSchema = z.object({
  auth_type: z.literal('oauth2'),
  token_url: z.string().describe('The URL to fetch the OAuth2 token from.'),
  client_id: z.string().describe('The OAuth2 client ID.'),
  client_secret: z.string().describe('The OAuth2 client secret.'),
  scope: z.string().optional().describe('The OAuth2 scope.'),
});

export type OAuth2Auth = z.infer<typeof OAuth2AuthSchema>;

/**
 * Combined authentication types.
 */
export const AuthSchema = z.discriminatedUnion('auth_type', [
  ApiKeyAuthSchema,
  BasicAuthSchema,
  OAuth2AuthSchema,
]);

export type Auth = z.infer<typeof AuthSchema>;
