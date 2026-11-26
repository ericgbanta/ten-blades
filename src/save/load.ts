// Loading a save from parsed JSON: migrate to the current version, then validate.

import type { CampaignSave, Result, SaveContext, SuspendSave } from './format';
import { migrate } from './migrate';
import { validateCampaign, validateSuspend } from './validate';

export function readCampaign(raw: unknown, ctx: SaveContext): Result<CampaignSave> {
  const m = migrate(raw);
  if (!m.ok) return m;
  const v = validateCampaign(m.value, ctx);
  return v.ok ? v : { ok: false, error: `This save could not be read (${v.error}).` };
}

export function readSuspend(raw: unknown, ctx: SaveContext): Result<SuspendSave> {
  const m = migrate(raw);
  if (!m.ok) return m;
  const v = validateSuspend(m.value, ctx);
  return v.ok ? v : { ok: false, error: `The suspended battle could not be read (${v.error}).` };
}
