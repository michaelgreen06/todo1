Main coordinator:
  GPT-5.5 high only for hard planning, architecture, final review, merge decisions.

Default coordinator:
  GPT-5.5 medium for most turns.

Subagents:
  GPT-5.4-mini or GPT-5.4 medium for read-only research, code search, test inspection, docs lookup.

Specialist implementation subagent:
  GPT-5.5 medium when editing important code.

Escalation:
  Only use GPT-5.5 high when the subagent gets stuck, makes cross-file changes, or needs deep design reasoning.

Use weaker/cheaper subagents for discovery.
Use stronger models for decisions.
Use strongest model for final integration.

codebase-mapper:
  cheap model, read-only, background OK

test-runner:
  cheap/medium model, Bash allowed, no edits, background OK

bug-hunter:
  GPT-5.4 medium or GPT-5.5 medium, foreground if permissions likely

implementer:
  GPT-5.5 medium, isolated worktree preferred

reviewer:
  GPT-5.5 medium/high depending on risk

coordinator:
  GPT-5.5 medium normally; high only for hard planning/final review