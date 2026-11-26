# Command line
`./skill-atlas scan <GitHub URL | directory>`; a GitHub organization's URL scans each of its repositories
Prints the result **at once**; *nothing is stored*.
`GITHUB_TOKEN`, optional: a higher GitHub rate limit.
## Output
```
JetBrains/kotlin · 6 skills
build-tools-bump-gradle-api — Bumps the Gradle API…
  https://github.com/JetBrains/kotlin/blob/<commit>/…
```
- Sorted by **name**; the description's *first sentence*
- `also in <paths>` for copies; warnings go to *stderr*
- No project skills → `<repo> · 0 skills`, exit code 0: not an error
## Organization
```
JetBrains · 2 repositories

JetBrains/kotlin · 6 skills
build-tools-bump-gradle-api — Bumps the Gradle API…
  https://github.com/JetBrains/kotlin/blob/<commit>/…

JetBrains/MPS · 0 skills
```
- `<owner> · N repositories` first, then each repository, a blank line before it, *printed as soon as it is scanned*
- Warnings name their repository: `warning: <repo>: …`; a repository that cannot be scanned: `warning: <repo>: <message>; skipped`
