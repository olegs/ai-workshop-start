When the new issue with tag "Delegated to AI" is created of the label is added to the exisiting issue, do the following:
* Create a branch for the fix with the name pattern delegated-to-ai/<ISSUE_ID>_<NAME>, where <ISSUE_ID> is the issue number, and <NAME> is the short description  
* Implement the fix
* If the fix changes the UI (what the web view shows or how it behaves: `src/web/`, `src/web.ts`), record a demo video,
  as spec/demo.md says:
  * Change `DEMO` in `mock/demo.ts` so that a person shows the change: what they click and type, the pauses to read;
    keep the demo 10 seconds at most
  * Use only the mock data in `mock/`, the same for each demo; add to `mock/github.ts` only what the change needs to be
    seen, and keep `npm test` green
  * Run `npx playwright install --with-deps chromium` and install ffmpeg if missing, then `npm run demo`: it writes
    `docs/demo.mp4` and its animated preview `docs/demo.gif`
  * Watch it: take a few frames with `ffmpeg -ss <second> -i docs/demo.mp4 -frames:v 1 <frame>.png` and look at them;
    the change must be visible, with no error or warning the change did not mean to show
  * Commit `docs/demo.mp4` and `docs/demo.gif` with the fix
* Create a Pull Request with the fix
* If a demo was recorded, attach it to the Pull Request: a `## Demo` section in its description that shows the preview
  in place, linked to the video, both at the pushed commit, and one line on what it shows:
  `[![<what it shows>](https://github.com/<owner>/<repo>/raw/<commit>/docs/demo.gif)](https://github.com/<owner>/<repo>/blob/<commit>/docs/demo.mp4)`.
  `gh` cannot upload a file as an attachment, and GitHub does not play an MP4 from the repository: the GIF is what
  plays in the description. After pushing, check that the description shows it: `curl -sIL` on the GIF's link answers
  200, `image/gif`
* In the fix loop, if a fix changes the UI again, record the demo again, commit it with the fix, and update both links
  in the Pull Request description to the new commit
* Check if it could be merged without any merges
* Check the result of the review automation on the Pull Request
* If nothing severe was found, merge the Pull Request
* If something severe was found and the issue has no label `DelegatedToAI`, stop here and request the attention of the AI operator
* If something severe was found (Request Changes or "Blocking:" findings) and the issue has the label `DelegatedToAI`, run the fix loop:
  * Address every blocking finding from the review automation, push the changes to the Pull Request branch, and reply to each addressed review comment
  * Wait up to 10 minutes for the review automation to post a new review on the updated Pull Request
  * Check the new review result: if nothing severe was found, merge the Pull Request and stop; otherwise repeat the loop
  * Count review rounds the same way as the review automation: at most 5 review rounds in total, the initial review counts as round 1, so at most 4 fixes
* In the fix loop, if the review automation did not respond within 10 minutes, stop here and request the attention of the AI operator
* If the 5th review still has severe findings, do not push another fix: stop right away and request the attention of the AI operator, saying that severe problems remain after 5 review rounds