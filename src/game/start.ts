import Phaser from 'phaser';

const COLS = 8;
const ROWS = 12;
const COLORS = [0x2a2433, 0x3a3046, 0x4a2a2e, 0x2e4a3a];

class GridScene extends Phaser.Scene {
  constructor() {
    super('grid');
  }

  create() {
    this.layout();
    this.scale.on('resize', () => this.layout());
  }

  private layout() {
    this.children.removeAll();
    const { width, height } = this.scale;
    const size = Math.floor(Math.min(width / COLS, height / ROWS));
    const ox = Math.floor((width - size * COLS) / 2);
    const oy = Math.floor((height - size * ROWS) / 2);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const color = COLORS[(r * 3 + c * 7 + ((r * c) % 3)) % COLORS.length] ?? COLORS[0]!;
        this.add
          .rectangle(ox + c * size, oy + r * size, size - 2, size - 2, color)
          .setOrigin(0)
          .setStrokeStyle(1, 0x6a5a7a);
      }
    }
  }
}

/** Create the Phaser game inside `parent`. Returns a function that destroys it. */
export function startGame(parent: HTMLElement): () => void {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0c0a0f',
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    scene: GridScene,
  });
  return () => game.destroy(true);
}
