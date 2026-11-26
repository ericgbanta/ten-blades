# Ten Blades

Ten Blades is a dark fantasy tactics RPG for the phone browser, in the style of classic Fire Emblem. It is a static site with no backend, built with TypeScript, Vite, Phaser 3 for the battle scenes and Preact for menus. It is deployed to GitHub Pages at `/ten-blades/`.

The design is in `docs/DESIGN.md` and the build plan and status are in `docs/PLAN.md`.

## Scripts

- `npm run dev`: start the Vite dev server.
- `npm run build`: type check, then build to `dist`.
- `npm run preview`: serve the built site.
- `npm run test`: run the Vitest unit tests.
- `npm run lint`: run ESLint.
- `npm run sim`: run the balance simulator (a stub for now).
- `npm run e2e`: run the Playwright smoke test at a phone viewport. Pass `-- --trace off`.
