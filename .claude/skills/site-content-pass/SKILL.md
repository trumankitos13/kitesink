---
name: site-content-pass
description: Add sourced reference entries to a kitesink.com content page in batches, each written by one agent and reviewed by a second. Use for a multi-batch research pass over an owner-approved source list (fitness, music or another page), or to review such a batch. Not for single-entry fixes, blog posts, or link and image updates.
---

# Site content pass

Content goes in as batches. One agent writes each batch and a second checks it. Each is
committed on its own, so a stop or a restart never loses more than the batch in progress.

## 1. Set up the area (once)

Agree these with the owner before writing anything.

- **Brief:** put the rules that are not private in a tracked file beside the content (as
  `content/fitness/WRITING-BRIEF.md` does), so every agent reads the same rules and a restart
  cannot lose them.
- **Target:** the content file(s), their schema, and the build that turns them into pages.
  Note each file's exact layout (indent, trailing newline) so edits never reformat it.
- **Sources:** what counts as a source for this area (papers, rulebooks, interviews, liner
  notes, official credits, rights databases) and how each is cited. Every fact needs a source
  a reader can open.
- **Reading list:** owner-approved, split into batches of about 15 to 20 long articles.
- **House rules:** voice, field lengths, and what the page must never do (for example:
  medical or legal advice, dosing, quoting lyrics or copying an author's wording or tables).
- **Checks:** a validator for the content file, a copy-overlap check against any private
  source material (default: no run of 8 words in common; review runs of 6), the build and the
  site tests. If the area has none, build or adapt them first and agree what they verify
  (for music, for example: credits against official credits or a rights database).
- **Holds and proposals:** keep a holds list (anything only the owner can decide) and a
  proposed-revisions file somewhere that survives a restart.

Private source material, notes and audit files stay outside the repository.

## 2. Run one batch

Run one agent at a time.

1. **Scope.** Pick the slice and a target count. Refresh the list of existing entries and
   sources so the writer can avoid repeats.
2. **Write.** Start a writer agent with the brief, the slice and the target. It appends new
   entries only, saves a valid file every few sources, and runs the checks itself. Any change
   to an entry from before this batch goes to the proposed-revisions file instead.
3. **Review.** Start a reviewer agent on a stronger, or at least different, model, never the
   writer itself. It checks every new entry against its sources with the checklist below and
   fixes what it finds. It may delete an entry that repeats the site or is too thin, and must
   list each deletion in its report.
4. **Lead verifies, after the writer and again after the reviewer.** The diff touches only
   this batch's entries and sources. Then build, run the checks, and commit and push to the
   working branch, the review fixes as their own commit.
5. **Record.** Update the pull request description and the owner's workplan: what landed,
   what was held back, what needs the owner.

If the container restarts, resume the stopped agent rather than starting again. If valid
work is sitting uncommitted, commit it marked as work in progress; it still gets reviewed.

## 3. Reviewer checklist

- Every fact and figure is in the part of the source a reader can open (a paper's abstract,
  the rule's own text, the published credit). Otherwise cut it, or attribute it to whoever
  said it.
- Opinion is labelled as opinion ("X's view is"), never written as fact, and no one is
  credited with more than they said.
- The scope is stated: who or what it is about, when, and where.
- Where sources disagree, or a later correction exists, the entry says so.
- Claims are only as strong as the evidence: a link is not a cause, one report is not a
  consensus.
- Every recommendation follows from a cited source, or is labelled as someone's practice.
- Nothing repeats another entry on the site. Point to it instead.
- Risky topics name the risk and point to a professional. Claims about living people are
  sourced and fair.
- Source records are correct: the link or DOI opens that exact item, and names, dates and
  titles match it.

## 4. Rules

- Never push to or merge into `main`, and never deploy, unless the owner asks in so many words.
- Never edit an entry from before the batch. Propose the change and let the owner decide.
- Never guess. If something cannot be checked, leave it out and say so in the report.
- Report each batch in plain terms: what was added, what the review fixed or deleted, and
  what is on hold.
