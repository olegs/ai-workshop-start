# mock

The mock data for demos, and the demo itself: see [spec/demo.md](../spec/demo.md).

| File | What |
| --- | --- |
| `github.ts` | what GitHub answers for `JetBrains` and its repositories `kotlin`, `MPS`, `koog`: the page's examples |
| `server.ts` | `npm run mock`: the web view over that data, on http://localhost:3000 |
| `demo.ts` | `npm run demo`: records `docs/demo.mp4`, at most 20 seconds, and its GIF preview `docs/demo.gif`; change `DEMO` in it to show a change |

The data is made up: the skills are not those of the real repositories. Change it only on purpose: every demo shows it.
