// packages/core/src/data/auth_implementations/oauth2_user_auth.ts
import { z } from 'zod';
import { Serializer } from '../../interfaces/serializer';
import { Auth } from '../auth';

/**
 * Interface for interactive (user sign-in) OAuth2 authentication.
 *
 * This variant is DECLARATIVE ONLY: it describes how a user-delegated token is
 * obtained (device-code or authorization-code flow) and carries the runtime
 * bearer token once provisioned. UTCP itself NEVER runs the interactive flow —
 * that requires a user channel and token persistence which a transport handler
 * does not have. An external tool (e.g. `@utcp/code-mode-cli login`) performs
 * the sign-in and writes the token into a variable referenced by `access_token`
 * (typically `"${MY_TOKEN}"`). At call time UTCP simply injects the resolved
 * token as a bearer header.
 *
 * For MCP manuals the endpoints are discovered from the server, so `grant_type`,
 * `token_endpoint`, `client_id` and the endpoint fields are optional — only
 * `access_token` is always required.
 */
export interface OAuth2UserAuth extends Auth {
  auth_type: 'oauth2_user';
  /** Runtime bearer token, normally an injected variable like "${MY_TOKEN}". */
  access_token: string;
  /** Which interactive flow the login tool should run. */
  grant_type?: 'device_code' | 'authorization_code';
  /** OAuth2 token endpoint (for HTTP manuals; discovered for MCP). */
  token_endpoint?: string;
  /** Public OAuth2 client id (omit for MCP dynamic client registration). */
  client_id?: string;
  /** Optional requested scope. */
  scope?: string;
  /** Device authorization endpoint — required for the device_code flow. */
  device_authorization_endpoint?: string;
  /** Authorization endpoint — required for the authorization_code flow. */
  authorization_endpoint?: string;
  /** Header name to inject the token into. Defaults to "Authorization". */
  var_name?: string;
  /** Token prefix. Defaults to "Bearer ". */
  prefix?: string;
}

export class OAuth2UserAuthSerializer extends Serializer<OAuth2UserAuth> {
  toDict(obj: OAuth2UserAuth): { [key: string]: any } {
    // Just spread the object since it's already validated
    return { ...obj };
  }

  validateDict(obj: { [key: string]: any }): OAuth2UserAuth {
    return OAuth2UserAuthSchema.parse(obj);
  }
}

/**
 * Authentication using an interactive (user-delegated) OAuth2 token.
 * The token is provisioned out-of-band by a login tool and injected as a
 * bearer header at call time. Not `.strict()` so providers can carry the
 * declarative flow metadata used by the login tool.
 */
const OAuth2UserAuthSchema: z.ZodType<OAuth2UserAuth> = z.object({
  auth_type: z.literal('oauth2_user'),
  access_token: z.string().describe('Runtime bearer token. Recommended to use an injected variable like "${MY_TOKEN}".'),
  grant_type: z.enum(['device_code', 'authorization_code']).optional().describe('Interactive flow the login tool should run.'),
  token_endpoint: z.string().optional().describe('OAuth2 token endpoint (discovered for MCP manuals).'),
  client_id: z.string().optional().describe('Public OAuth2 client id (omit for MCP dynamic client registration).'),
  scope: z.string().optional().describe('Optional requested scope.'),
  device_authorization_endpoint: z.string().optional().describe('Device authorization endpoint — required for the device_code flow.'),
  authorization_endpoint: z.string().optional().describe('Authorization endpoint — required for the authorization_code flow.'),
  var_name: z.string().optional().describe('Header name to inject the token into. Defaults to "Authorization".'),
  prefix: z.string().optional().describe('Token prefix. Defaults to "Bearer ".'),
}) as z.ZodType<OAuth2UserAuth>;
