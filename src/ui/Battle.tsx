import { useEffect, useRef } from 'preact/hooks';

/** Mounts the Phaser game on this route only, and destroys it on leave. */
export function Battle() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let destroy: (() => void) | undefined;
    let cancelled = false;
    void import('../game/start').then(({ startGame }) => {
      if (cancelled || !host.current) return;
      destroy = startGame(host.current);
    });
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, []);
  return (
    <div class="battle">
      <div class="battle-host" ref={host} />
      <a class="btn back" href="#/">
        Back
      </a>
    </div>
  );
}
