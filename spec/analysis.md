# Repository analysis
## Input
A **GitHub repository** URL, or a local directory
## Output
Every *project skill*: **name**, **description**, **link**
## Architecture
Core: fetch → find → parse. CLI: a *thin client*.
Skill: id = `repo:path`, name, description, commit
## Project skill
A skill an agent loads when it works in the repository:
`<dir>/<root>/<name>/SKILL.md`
- `<root>`: an agent's skill folder — `.agents/skills`, `.claude/skills`, `.github/skills`, `agent/skills`
- `<dir>`: the repository root, or *any directory in it* (a module of a monorepo)
- `<name>`: the skill's directory, *directly* in `<root>`
- Names are exact, case-sensitive: `SKILL.md`, and each folder of `<root>`
### Not a project skill
Ignored, *no warning*: a large repository has many.
- A `SKILL.md` outside a skill folder: docs, test data, the repository root, a plugin's or a
  collection's `skills/`
- `<root>/SKILL.md`, with no skill directory
- Deeper inside a skill: `<root>/<name>/…/SKILL.md` is one of the skill's own files, a template,
  even where `…` looks like a skill folder: `.claude/skills/agent/skills/x/SKILL.md`
- Under `node_modules` or `.git`: dependencies, not the project's
- In a Git submodule, or a nested checkout with its own `.git`: another repository
- A symbolic link, to a file or a folder: the target is scanned where it really is
### Copies
The same skill under another agent's folder: one skill, listed `also in <paths>`
- A copy: the same `<dir>` and `<name>`, and the *same bytes*
- The skill is the one in the first `<root>` of the order above
- Different bytes → *two skills*, each with its own link
- The same `<name>` in another `<dir>` → another skill
## Details
- **GitHub API**, no clone; *under 5 s* for intellij-community
- The name: front matter, else the directory `<name>`
- The link pins the *scanned commit*
- Malformed front matter → a *warning*, the scan goes on
- No front matter or no description → the name alone
- Tree too large for one answer, no `GITHUB_TOKEN` → only the root's skill folders, a *warning*
- Unreachable repository → a clear message, exit code 1
