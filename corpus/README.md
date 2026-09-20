# Optional Ask corpus (not vendored)

onesong-ask-bridge keeps passage expansion **thin**.

Do **not** copy the full `question-md-corpus` tree into this repo unless you
intentionally want Production Live Ask to resolve `contextBefore` / full
paragraph / `contextAfter` from local markdown. The teacher texts are large
and many are not redistributable.

## Recommendation

1. Leave `corpus/` empty on the bridge (this default).
2. Expansion still runs against Gemini File Search retrieved text.
3. When that text is too short or the snippet cannot be located,
   citations return `limitedContext: true` and **no invented neighbors**.
4. If you want book-faithful neighbors on the Vercel Production deploy,
   vendor a **filtered** markdown drop (the same files File Search was
   indexed from) using the layout below, then redeploy `main`.

## Layout if you do vendor

```
corpus/
  Gurdjieff/
    views-from-the-real-world.md
  Dougan/
    forty-days.md
```

Optional YAML frontmatter (used for teacher/title matching):

```md
---
teacher: Gurdjieff
title: Views from the Real World
---
```

Without frontmatter, the first path segment is the teacher and the filename
stem is the title (`views-from-the-real-world` → `Views from the Real World`).

`README.md`, `_`-prefixed folders, and dotfiles are ignored.

`vercel.json` already includes `corpus/**` in the serverless bundle so a
vendored drop is picked up on the next Production deploy. No DNS change.
