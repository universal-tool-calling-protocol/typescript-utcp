// packages/core/src/data/auth.ts
import { z } from 'zod';
import { Serializer } from '../../interfaces/serializer';
import { Auth } from '../auth';

/**
 * Interface for OAuth2 authentication details (Client Credentials Flow).
 */
export interface OAuth2Auth extends Auth {
  auth_type: 'oauth2';
  token_url: string;
  client_id: string;
  client_secret: string;
  scope?: string;
}

export class OAuth2AuthSerializer extends Serializer<OAuth2Auth> {
  toDict(obj: OAuth2Auth): { [key: string]: any } {
    // Just spread the object since it's already validated
    return { ...obj };
  }

  validateDict(obj: { [key: string]: any }): OAuth2Auth {
      return OAuth2AuthSchema.parse(obj);
  }
}

/**
 * Authentication using OAuth2 client credentials flow.
 * The client automatically handles token acquisition and refresh.
 */
const OAuth2AuthSchema: z.ZodType<OAuth2Auth> = z.object({
  auth_type: z.literal('oauth2'),
  token_url: z.string().describe('The URL to fetch the OAuth2 access token from. Recommended to use injected variables.'),
  client_id: z.string().describe('The OAuth2 client ID. Recommended to use injected variables.'),
  client_secret: z.string().describe('The OAuth2 client secret. Recommended to use injected variables.'),
  scope: z.string().optional().describe('Optional scope parameter to limit the access token\'s permissions.'),
}).strict() as z.ZodType<OAuth2Auth>;
