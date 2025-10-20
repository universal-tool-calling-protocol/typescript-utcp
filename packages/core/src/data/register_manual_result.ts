// packages/core/src/data/register_manual_result.ts
import { CallTemplate } from './call_template';
import { UtcpManual } from './utcp_manual';

/**
 * Result of a manual registration operation.
 */
export interface RegisterManualResult {
  manualCallTemplate: CallTemplate;
  manual: UtcpManual;
  success: boolean;
  errors: string[];
}