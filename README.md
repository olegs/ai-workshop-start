# Skill Atlas

Every agent skill in a repository: `./skill-atlas scan` finds each project skill's `SKILL.md` and prints its name,
description and link.

```console
$ npm ci
$ ./skill-atlas scan https://github.com/JetBrains/kotlin
JetBrains/kotlin · 6 skills
…
build-tools-bump-gradle-api — Bumps the Gradle API version that Kotlin Gradle plugins are compiled against in the Kotlin compiler repository.
  https://github.com/JetBrains/kotlin/blob/5ab6270ab772d113e8ad52ebfcaa0109c522ae00/.claude/skills/build-tools-bump-gradle-api/SKILL.md
…
```

A GitHub organization's URL, `./skill-atlas scan https://github.com/JetBrains`, scans each of its repositories, one by
one; set `GITHUB_TOKEN` for a large one.

`npm start` opens the web view on http://localhost:3000: type a repository or an organization, press Scan.

Set `GITHUB_TOKEN` for a higher GitHub rate limit. `npm test` runs the tests.

## Automations

- [skills/issue-solve.md](skills/issue-solve.md): an issue labeled "Delegated to AI" gets a branch, a fix and a Pull
  Request; it merges, or asks the AI operator about blocking review findings. With the label `DelegatedToAI` it
  addresses them and updates the PR instead, waiting up to 10 minutes for each new review, at most 5 rounds.
- [skills/code-review.md](skills/code-review.md): reviews a Pull Request with inline comments and a verdict; when the
  issue has the label `DelegatedToAI`, after Request Changes it waits up to 10 minutes for new commits and reviews again,
  at most 5 rounds.

- [spec/](spec/): what it does. [AGENTS.md](AGENTS.md): the definition of done.
- [fixture/](fixture/README.md): a small repository for the tests.
