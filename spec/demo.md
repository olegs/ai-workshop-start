# Demo
A short video of the web view, `docs/demo.mp4`, for a pull request that changes it; over **mock data**, the same in every demo.
## Mock data
`mock/github.ts`: what GitHub answers, **never the network**
- The page's examples, `JetBrains/kotlin`, `JetBrains/MPS`, `JetBrains/koog`, each with its skills, no warnings;
  one skill in two agents' folders, its copy as `also in`
- The organization `JetBrains`: those three repositories
- The same answers every time; anything else is *not recorded*: the page shows why, *502*
- `npm run mock`: the web view over it, on **port 3000** (`PORT` overrides); each answer after `MOCK_DELAY` ms, 150 by
  default, so the placeholders show
## Video
`npm run demo` records it into `docs/demo.mp4`, or the path given
- Chromium, through Playwright, **1280×720**, light; the page only, its own cursor drawn in it
- Plays a person: the mouse glides to what it clicks, keys typed one at a time, pauses to read the results
- **10 seconds at most**: a longer demo fails, to be shortened; the blank page before the first one is cut
- H.264 MP4, so GitHub plays it
- Needs Chromium for Playwright (`npx playwright install --with-deps chromium`) and ffmpeg; without them its test is
  skipped
