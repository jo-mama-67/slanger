<script>
(function () {
'use strict';

/* =====================================================================
   CONFIG
   ===================================================================== */
const CONFIG = {
  NAME: 'Slanger',
  TAGLINE: 'one in a slanger',
  STORE_KEY: 'slanger.v1',
  LEGACY_KEYS: ['deepdive.v1'],
  SCHEMA: 2,
  EPOCH: '2026-11-01',          // Dive #1
  PER_DAY: 7,
  MAX_GUESSES: 6,
  SHARE_URL: 'slanger-it.netlify.app', // change to the real address once it is on the web
  AUTOCORRECT_SCORE: 92,        // a typo of the answer solves it, but never reaches the Slanger
  BONUS_PER_SPARE_GUESS: 150,
  HINT_CAP: 9999,               // once a hint is taken the trench is out of reach
  WORD_MS: 60000,               // oxygen per word
  TIME_BONUS_PER_SEC: 20,       // clean solves bank 20m per second of oxygen left
  SPEED_MS: 90000,              // Speed Trench clock
  REVERSE_QS: 10,
  PACK_SIZE: 8,
  PACKS: [
    { key: 'money',     name: 'Money',     tags: ['money', 'rich', 'poor', 'stingy'], blurb: 'Broke, minted and everything in between.' },
    { key: 'drunk',     name: 'Drunk',     tags: ['drunk', 'hangover'],               blurb: 'From tipsy to absolutely legless.' },
    { key: 'internet',  name: 'Internet',  tags: ['internet'],                        blurb: 'Words that only make sense online.' },
    { key: 'gym',       name: 'Gym',       tags: ['gym'],                             blurb: 'Gains, gym rats and skipped leg days.' },
    { key: 'workplace', name: 'Workplace', tags: ['work'],                            blurb: 'Office-speak and quiet rebellion.' },
    { key: '2000s',     name: '2000s',     tags: [],                                  blurb: 'Bling, noobs and frosted tips.' }
  ],
  HINTS: [
    { key: 'letter', label: 'First letter', cost: 1200 },
    { key: 'length', label: 'Length',       cost: 600 },
    { key: 'pos',    label: 'Word type',    cost: 400 },
    { key: 'peek',   label: 'Peek letters', cost: 2500 }
  ],
  // score bands → word-themed depth zones (index doubles as zone colour z0..z6)
  ZONES: [
    { key: 'gibberish',  name: 'Gibberish',  min: 0,   max: 9,   d0: 0,     d1: 50,    emoji: '⬜' },
    { key: 'smalltalk',  name: 'Small Talk', min: 10,  max: 29,  d0: 50,    d1: 200,   emoji: '🟨' },
    { key: 'buzzword',   name: 'Buzzword',   min: 30,  max: 49,  d0: 200,   d1: 1000,  emoji: '🟧' },
    { key: 'jargon',     name: 'Jargon',     min: 50,  max: 69,  d0: 1000,  d1: 4000,  emoji: '🟩' },
    { key: 'vernacular', name: 'Vernacular', min: 70,  max: 89,  d0: 4000,  d1: 6000,  emoji: '🟦' },
    { key: 'lingo',      name: 'Lingo',      min: 90,  max: 99,  d0: 6000,  d1: 10000, emoji: '🟪' },
    { key: 'slanger',    name: 'Slanger',    min: 100, max: 100, d0: 10994, d1: 10994, emoji: '🎯' }
  ],
  // Guess filter: FNV-1a hashes of a short slur blocklist, so the source never shows the words.
  BLOCK: __BLOCK__,
  SEED_SNAPSHOT: __SNAPSHOT__
};

