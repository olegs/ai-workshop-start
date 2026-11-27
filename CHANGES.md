# Changes

Meaningful changes, newest first; how to log one: [.agents/skills/changes/SKILL.md](.agents/skills/changes/SKILL.md).

## 2026-11-27
- The CLI and the web view no longer cut a description's first sentence at an abbreviation such as `e.g.` or `i.e.`
  (#34).
- A skill, [.agents/skills/status-update/SKILL.md](.agents/skills/status-update/SKILL.md), posts a weekly status update in Slack: a summary
  of the last 7 days from this change log, and a table of the issues closed and the Pull Requests merged.
- The red agent posts a status update in Slack after every hunt, even when it finds no bug or every bug is already
  open, so a quiet run is told apart from one that did not run.
- The repository automations are discoverable as standard project skills under `.agents/skills/`.
- A skill, [.agents/skills/red-agent/SKILL.md](.agents/skills/red-agent/SKILL.md), a QA engineer that hunts for bugs in at most 5 attempts,
  files the most important new one as an issue with the shortest way to reproduce it, and announces it in Slack.
- The web view has a Cluster button by the filter: it groups the skills scanned by what their names and descriptions
  say (TF-IDF and cosine similarity, in the page), each group labelled by the words it shares, on a Plotly map of the
  skills, so that similar skills across repositories are seen together (#31).
- A skill, [.agents/skills/human/SKILL.md](.agents/skills/human/SKILL.md), to ask in Slack for clarification or confirmation of the plan when an
  issue is vague or big, before implementing it (#29).
- A skill, [.agents/skills/changes/SKILL.md](.agents/skills/changes/SKILL.md), to log every meaningful change here (#27).
