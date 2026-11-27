---
name: changes
description: Log meaningful changes in the change log, newest first and in plain words.
---

Log every meaningful change to [CHANGES.md](../../../CHANGES.md), in the same commit as the change.

What to log: a change a user or a contributor would want to know about: a new feature or command, a change in what the
CLI prints or the web view shows, a fixed bug they could have met, a new or changed automation or skill, a change to
the setup or the commands.

What not to log: quick fixes, typos, small refactorings, test-only changes, formatting, dependency bumps that change
nothing visible.

How:
* Newest first, under a `## <YYYY-MM-DD>` heading for the day; add the heading if it is not there yet.
* One line per change: what changed and why it matters, in plain words, then the issue or Pull Request, e.g.
  `- The web view keeps what it scanned for 24 hours (#12).`
* Edit the entry instead of adding another when a later commit in the same Pull Request changes it.
