# Ten Blades

Ten Blades is a dark fantasy tactics RPG for the phone browser, in the style of classic Fire Emblem. It is a static site with no backend, deployed to GitHub Pages at `/ten-blades/`.

The design is in `docs/DESIGN.md`. The build plan, the working defaults for open design questions, and the current status are in `docs/PLAN.md`. Read both before starting a phase, and update the status table in the plan when a phase finishes.

## How to work

- Build one phase at a time, following `docs/PLAN.md`.
- Commit after each completed task with a clear message. Commits are authored as Eric (the repo's git config is set for this). Eric has allowed pushing straight to `main`.
- If the design is unclear or two sections conflict, ask before guessing.

## Architecture rules

- `/src/core` is pure TypeScript. It must not import Phaser or Preact or touch the DOM, `window`, or storage, so it runs under Vitest.
- All randomness goes through the seeded RNG in `/src/core/rng.ts`, and the RNG state is part of the battle state. Never call `Math.random()` in game logic.
- Every balance number and all content (classes, weapons, blades, units, maps, chapters, dialogue) lives in JSON under `/src/data`. New chapters should not need engine changes.
- The core applies actions to a battle state and returns the new state plus events. `/src/game` (Phaser) and `/src/ui` (Preact) display state and play events. They do not hold rules.
- TypeScript strict mode everywhere.
- Original names and art only. Nothing copied from Fire Emblem or any other game.

## Art

- Load every image through the manifest at `/src/art/assets.json`. If an image is missing, draw a simple placeholder shape. Never block a feature on art.
- New art follows the Codex process described in the plan and, once written, `docs/ART_GENERATION.md`. Do not hand-draw final art or change the style without asking Eric. Tell him how many images a task needs before generating, because it uses his Codex limits.

## Mobile first

- Design at 375 x 667 portrait first, then check 430 wide and landscape.
- Tap targets are at least 44 x 44 px. No hover-only controls.
- Respect safe-area insets and `prefers-reduced-motion`.

## Saves

- Saves live in IndexedDB: 3 slots plus a suspend slot. Each save is one JSON object with a `version` field.
- Any change to the save shape bumps the version and adds a migration plus a test that loads a fixture from the previous version.
- Export and import of a save code must keep working.

## Testing

- Run everything locally. The only GitHub Actions workflow is `.github/workflows/deploy.yml`, which publishes to Pages. Do not add others.
- Before calling a task done, run `npm run test`, `npx tsc --noEmit`, and `npm run lint`.
- Combat, the triangle, leveling, AI and save migrations need unit tests with fixed seeds.
- `npm run sim` runs the balance simulator. `npm run e2e` runs the Playwright smoke test at a phone viewport (pass `-- --trace off`).

## Deployment

- `vite.config.ts` sets `base: '/ten-blades/'`. Routing uses the URL hash.
- `/public/.nojekyll` must exist.
- `main` is what's live. The deploy workflow runs tests, builds, and publishes `dist` whenever `main` changes.
