# Slanger

*One in a slanger.* Read a slang definition, guess the word, and sink as deep as your guess deserves.

Play it: https://slanger-game.netlify.app

## What's here

- `public/index.html` — the whole game in one file. No build step, no network requests, no dependencies.
- `src/` — the source it's assembled from:
  - `head.html` — styles and page skeleton
  - `config.js` — zones, timers, hints, packs, share link
  - `data.js` — the puzzle pack and the slang lexicon (swap the `PUZZLES` array to change the words)
  - `app.js` — scoring, autocorrect, storage, every mode, animation and sound
  - `fonts/` — Cardo and Fira Sans subsets (SIL Open Font License, licences alongside). The build inlines them, so the page still makes no requests.
  - `build.js` — run `node src/build.js` to rebuild `public/index.html`

## Deploying

Netlify publishes the `public/` folder (see `netlify.toml`). Auto-publishing is off: each push to `main` builds a preview deploy, and it only goes live when it's published from the Netlify Deploys page.

## Checks

Open the game, then run `SLANGER.SELFTEST()` in the browser console.

Definitions are written for this game, not copied from Urban Dictionary.
