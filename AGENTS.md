## Deployment

- Pushing to or merging into `main`, or running `wrangler deploy`, can
  publish production. Do not do so unless explicitly requested.

## Delegation

- For complex or long-running work, the primary agent may delegate bounded,
  independent tasks to subagents when doing so improves speed, quality, or
  context management.
- Use a fast agent for read-heavy reconnaissance, repository mapping, searches,
  inventories, logs, and test discovery.
- Use a capable implementation agent for well-scoped coding, debugging,
  migrations, and tests.
- Keep architectural decisions, ambiguous tradeoffs, coordination, and final
  verification in the primary thread.
- Do not delegate trivial work.
- Avoid concurrent edits to overlapping files.
- The primary agent must inspect resulting diffs and run final validation.
