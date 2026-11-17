# Rehearsal: landing feature scenes

Three stageshow scenes replace the old `scenes.tsx` cards in the landing page's
`#work` section. Each is a `play="once"` Stage with a poster, sized for the
544px tile, with a `compact` design below 500px of container width.

| Scene | Gold copied | Story |
|---|---|---|
| `answers.tsx` | `magic-agent` (WhatsApp chrome), `overlap` | Typing, the catalogue row lights, the answer quotes ₹1,150 level with it |
| `collects.tsx` | `magic-agent` | Each customer reply fills an enquiry field; status rolls to Ready to quote |
| `pipeline.tsx` | `controls` (Slot), `subscriptions` (Fly) | A quiet lead is followed up, replies, and files itself into Ready to quote; counts roll |

Changed from the golds: re-cropped for a 544 tile, site tokens (`--ok`, mesh
ground, `--font-sans`), Hugeicons instead of lucide (the kit's `Icon` was
ported), WhatsApp timestamps pinned with a spacer instead of floated, no
iMessage tails, real names in the pipeline board.

## Checked

- `film.mjs --gate` passes for every scene at 544 (wide) and 390 (compact),
  plus `--states` for the pipeline.
- Real page at 1280, 820 and 390, light and dark (`.dark` on `<html>`),
  reduced motion (poster).
- `tsc --noEmit` and eslint on the changed files.

## Notes

- Filmed against a local preview route that renders one scene at tile width.
  The page itself breaks film.mjs's full-height viewport.
- The kit-override detector skips stylesheets by `/kit/` URL; Next bundles
  the kit into a `components_landing_*` chunk, so filming used a copy that
  also skips rules inside `@layer stageshow`. Without it the kit's own phone
  rules are reported.
- Candidate lines left: `touching` on WhatsApp timestamps (they sit in a
  reserved spacer, words never meet), near-tangents on bubbles scrolled fully
  under the chat header, `Count` digit strips reported as appearing.

## Not checked

- Safari and Firefox; a real phone; touch.
- A fresh-eye review by a second reviewer.
- Long-term behaviour when the scenes leave and re-enter view repeatedly.
