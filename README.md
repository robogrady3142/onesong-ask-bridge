# onesong-ask-bridge

Temporary Gemini File Search proxy for onesong.group Ask.

Env: `GEMINI_API_KEY` (Vercel Production).
Auth header: `x-onesong-bridge: onesong-bridge-2026-09`

Production URL: `https://onesong-ask-bridge.vercel.app` (do not change onesong.group DNS).

## Citation passage context

Successful Ask responses include citation objects that may carry:

- `snippet` — File Search excerpt (unchanged)
- `limitedContext: true` — only when no File Search snippet/context could be attached; no invented neighbors
- `corpusAvailable` — whether markdown was bundled under `corpus/`

### Corpus: keep thin on the bridge

Do **not** vendor the full `question-md-corpus` into this repo by default.

| Choice | When | Effect |
| --- | --- | --- |
| Thin (default) | Leave `corpus/` empty | Expand from File Search retrieved text only. Short/unmatched snippets → `limitedContext: true`. |
| Vendor filtered markdown | Copy the indexed `.md` files under `corpus/<Teacher>/…` | Book-faithful neighbors when the snippet matches. `vercel.json` already includes `corpus/**`. |

See `corpus/README.md` for layout and frontmatter.

## Deploy notes (Rob)

1. This repo’s **`main`** is the Vercel Production branch for `onesong-ask-bridge`.
2. Merge/push to `main` → Production redeploy. No onesong.group DNS change.
3. Confirm `GEMINI_API_KEY` is still set on the Production environment.
4. After deploy, `POST /api/onesong-question` should return `limitedContext` on each citation. `corpusAvailable: false` until you drop markdown into `corpus/`.
5. Local check: `npm test`.
