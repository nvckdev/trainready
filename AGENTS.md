<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# `main` is canonical — audit and review against it

Read the code on `main` (or a branch you have confirmed descends from it). Everything ships here: the Next.js dashboard, the `engine/`, the `pipeline/`, **and the Expo app under `mobile/`**.

Check before you review, not after:

```bash
git rev-parse --abbrev-ref HEAD && git log --oneline -1
git merge-base --is-ancestor main HEAD && echo "current" || echo "STALE — behind main, findings will be wrong"
```

If that says STALE, stop and say so. Do not report findings from a branch behind `main`.

This rule exists because it was violated. On 2026-08-05 a 44-agent review ran against a `main` that was 42 commits behind the working branch and did not track `mobile/` at all. Verifiers rejected real defects with "the file does not exist" and confirmed others against code nobody was running — the review returned confidently wrong verdicts in both directions, and the two genuine bugs it did find were nearly lost in the noise. A stale checkout does not fail loudly; it produces plausible, well-argued, useless output.

Two habits that make the failure visible:

- **Cite `file:line` and quote the line.** A citation that cannot be resolved on `main` is the tell.
- **Name the SHA you reviewed** in your report. If it is not an ancestor-or-equal of `main`, the review is void.

Absence of a file is evidence about your checkout first, and about the code second.
