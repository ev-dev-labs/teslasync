# Task queue for the Experiments work

Small, numbered tasks that any agent (including a local model) can do
one at a time, on Windows.

- `RULES.md`: rules for every task. Read it first.
- `STATUS.md`: the queue. Each task is `todo`, `done` or `blocked`.
- `NN-*.md`: one task per file, done in number order.

An agent opens `STATUS.md`, takes the first `todo` task, does it, runs
its Verify commands until they pass, commits, marks it `done`, pushes,
and ends. One task per session.

The runner prompt and loop script live in `agent-loop/` (copy that
folder to `C:\Users\<you>\agent-loop`).
