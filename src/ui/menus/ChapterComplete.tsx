// Shown after a won chapter. The campaign is already saved by then.

import { useEffect } from 'preact/hooks';
import { gameData } from '../../data';
import { finishedRun } from '../saves';
import { chapterName } from './copy';
import './menus.css';

export function ChapterComplete() {
  const done = finishedRun();
  useEffect(() => {
    if (!done) window.location.replace('#/');
  }, [done]);
  if (!done) return null;
  const { campaign, chapterName: name, slot } = done;
  const next = campaign.progress.current;
  return (
    <main class="title chapter-done">
      <p class="chapter-kicker">{name}</p>
      <h1 class="chapter-title">Chapter complete</h1>
      <p class="tagline">Saved to slot {slot}.</p>
      <ul class="roster framed" aria-label="Your party">
        {campaign.party.map((u) => (
          <li key={u.id}>
            <span>{u.name}</span>
            <span class="muted">
              {gameData.classes[u.classId]?.name ?? u.classId} · Lv {u.level}
            </span>
          </li>
        ))}
      </ul>
      {campaign.fallen.length > 0 && (
        <p class="roster-fallen">Lost for good: {campaign.fallen.map((u) => u.name).join(', ')}</p>
      )}
      <p class="chapter-next">{next === null ? 'To be continued' : `Next: ${chapterName(next)}`}</p>
      <a class="btn primary" href="#/">
        Title
      </a>
    </main>
  );
}
