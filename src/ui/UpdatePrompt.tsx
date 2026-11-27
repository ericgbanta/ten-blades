// "Update ready": shown on the title screen when a newer build of the game has been downloaded and is waiting.
// Reload switches to it now; Later hides the note, and the new build starts by itself the next time the game is
// opened fresh. Saves are in IndexedDB and are not touched either way.

import { useEffect, useState } from 'preact/hooks';
import { onUpdate, pendingUpdate, type UpdateHandle } from '../pwa/register';

export function UpdatePrompt() {
  const [update, setUpdate] = useState<UpdateHandle | null>(pendingUpdate);
  const [hidden, setHidden] = useState(false);
  useEffect(() => onUpdate(setUpdate), []);
  if (!update || hidden) return null;
  return (
    <div class="update-note framed" role="region" aria-label="Update ready">
      <p class="update-text">
        <span class="update-title">Update ready</span>
        <span class="update-line">A new version of the game is downloaded.</span>
      </p>
      <div class="update-actions">
        <button type="button" class="btn quiet" onClick={() => setHidden(true)}>
          Later
        </button>
        <button type="button" class="btn primary" onClick={() => update.apply()}>
          Reload
        </button>
      </div>
    </div>
  );
}
