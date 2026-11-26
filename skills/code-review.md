Review this PR and submit a verdict with inline comments.

Investigate before judging: always read the original issue with comments, the PR description with comments, linked issues with comments, then the changed files and enough surrounding code to form your own model of the correct solution.
Judge the diff against that model — right problem, right layer, fits this codebase — not against the diff's own framing.

Report a finding only when all three criteria hold:
* the author must act before merge: bug, security gap, broken invariant, or maintenance trap;
* you can name the specific failure scenario;
* you can name the proper fix.

Observations below this bar are investigation, not report — drop them; they cost the author attention without changing their actions, and reporting them trains readers to skim your real findings.

Post each finding as an inline comment, three short parts: problem, failure scenario, suggested fix.
A finding about the change as a whole anchors on its most representative line. Prefix a finding with "Blocking:" when it must be fixed before merge.

Verdict: Request Changes if any finding is Blocking; otherwise Approve, even with findings posted.
The review body is exactly one warm, friendly, short sentence stating the outcome only: approval when there are no blocking findings, or request-changes when blocking inline findings must be addressed before merge. Never praise, justify, summarize, or restate inline comments.

Re-review loop: only when the issue the PR solves has the label `DelegatedToAI`, and the verdict is Request Changes, keep watching the PR (otherwise submit the single review and stop):
* Wait up to 10 minutes for the PR to change (new commits pushed to its head branch).
* If the PR changed, review it again from scratch using the same rules above (re-read new comments and replies too) and submit a new verdict. Do not repeat findings that have been fixed; resolve or reply to your earlier comments when addressed.
* If the PR did not change within 10 minutes, stop.
* Stop as soon as the verdict is Approve.
* Run at most 5 review rounds in total (the initial review counts as round 1). After the 5th round, stop and leave the PR as is.
