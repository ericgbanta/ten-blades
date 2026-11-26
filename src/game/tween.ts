import type Phaser from 'phaser';

/**
 * Run a tween and resolve when it ends. A tween can be killed early (a pan, a
 * resync), which skips its callbacks, so a timer also resolves it just after it
 * should have finished. Playback must never wait forever.
 */
export function tweenDone(scene: Phaser.Scene, config: Phaser.Types.Tweens.TweenBuilderConfig, ms: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    scene.tweens.add({ ...config, duration: ms, onComplete: finish, onStop: finish });
    scene.time.delayedCall(ms * (config.yoyo ? 2 : 1) + 100, finish);
  });
}
