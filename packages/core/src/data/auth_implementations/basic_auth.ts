// packages/core/src/data/auth.ts
import { z } from 'zod';
import { Serializer } from '../../interfaces/serializer';
import { Auth } from '../auth';

/**
 * Interface for Basic authentication details.
 */
export interface BasicAuth extends Auth {
  auth_type: 'basic';
  username: string;
  password: string;
}

export class BasicAuthSerializer extends Serializer<BasicAuth> {
  toDict(obj: BasicAuth): { [key: string]: any } {
    // Just spread the object since it's already validated
    return { ...obj };
  }

  validateDict(obj: { [key: string]: any }): BasicAuth {
      return BasicAuthSchema.parse(obj);
  }
}

/**
 * Authentication using HTTP Basic Authentication.
 * Credentials typically contain variable placeholders for substitution.
 */
const BasicAuthSchema: z.ZodType<BasicAuth> = z.object({
  auth_type: z.literal('basic'),
  username: z.string().describe('The username for basic authentication. Recommended to use injected variables.'),
  password: z.string().describe('The password for basic authentication. Recommended to use injected variables.'),
}).strict() as z.ZodType<BasicAuth>;
