---
name: status-update
description: Summarize the last week's updates, with a table of closed issues and merged pull requests, and post it in Slack.
---

Post a weekly status update: what changed in the repository over the last 7 days, in plain words.

Gather, for the last 7 days (`SINCE=$(date -u -d '7 days ago' +%Y-%m-%d)`):
* Closed issues: `gh issue list --state closed --search "closed:>=$SINCE" --limit 200 --json number,title,url,closedAt,stateReason`.
  Leave out issues closed as not planned or duplicates (`stateReason`), unless the reason matters.
* Merged Pull Requests: `gh pr list --state merged --search "merged:>=$SINCE" --limit 200 --json number,title,url,mergedAt,author`.
* [CHANGES.md](../../../CHANGES.md): the entries under the `## <YYYY-MM-DD>` headings from `$SINCE` on. They say what
  changed and why it matters; use them for the summary, and the issues and Pull Requests for the table.
* Commits to the default branch without a Pull Request, if any: `git log --since="$SINCE" --first-parent --oneline origin/HEAD`.

Write the update:
* A title: `Weekly status: <SINCE> – <today>` and the repository's name.
* A summary: 3 to 5 short lines on what changed for a user or a contributor, grouped by theme (features, fixes,
  automations, setup), taken from CHANGES.md; no line per commit.
* A summary table, one row per closed issue and merged Pull Request, newest first:
  | Type | # | Title | Closed / merged |
  |------|---|-------|-----------------|
  Slack does not render Markdown tables: put the table in a code block (```` ``` ````), its columns aligned, with each
  number linked below it, or as a list `• <url|#12> Title (merged 2026-11-25)` when the table is too wide.
* The totals: N issues closed, M Pull Requests merged.
* Nothing in the last 7 days: say so, in one line, and still post it.
* Sign it as the status update automation.

Post it in Slack:
* Post to the channel `ai-workshop-munich-2026-os` with the bot token in `SLACK_BOT_TOKEN`, as the
  [human skill](../human/SKILL.md) says; one message, no thread to wait on. Never print the token.
* Check the answer is `"ok": true`; on `"ok": false`, read `error`.
* `SLACK_BOT_TOKEN` not set, or Slack unavailable: print the update in the final answer and say it was not posted.

Done when the update for the last 7 days is posted in Slack, or printed with the reason it was not.
