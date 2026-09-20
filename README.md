# onesong-ask-bridge

Temporary Gemini File Search proxy for onesong.group Ask.

Env: `GEMINI_API_KEY` (Vercel Production).
Auth header: `x-onesong-bridge: onesong-bridge-2026-09`

Production URL: `https://onesong-ask-bridge.vercel.app` (do not change onesong.group DNS).

## Deep dive

`POST /api/onesong-question` accepts optional `depth: "standard" | "deep"` (default `standard`). `deepDive: true` is the same as `depth: "deep"`.

Standard Ask is unchanged: ~350–500 words; Default (and Custom with ≥3 selected teachers) must cite at least three different teacher surnames.

Deep dive aims for ~1000–1400 words. Default must cite at least five different teacher surnames (retry once after merge if short; never invent citations). Custom deep requires one distinct surname per selected teacher (if they selected 7, require 7) and cites only within that selection — not a fixed 5 unless they selected ≥5. Deep prefers `gemini-3.5-flash` (flash-lite fallback). Citation format is unchanged: `[1][2]…` in the body plus a trailing References block the server strips/merges.

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
