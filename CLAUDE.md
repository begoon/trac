# CLAUDE.md

Project-level context for future Claude Code sessions in this repo.

## What this is

A TRAC-64 interpreter (Calvin Mooers 1964; etude in Wetherell's *Etudes for Programmers*, 1978), written in TypeScript. Published to npm as `trac64i` (the names `trac` and `trac64` were already taken / rejected for name-similarity). Hosted playground at <https://begoon.github.io/trac/>.

## Toolchain

- **Runtime**: Bun for development and tests; Node 24+ for the published CLI.
- **Tests**: `bun test` (81 cases in `trac.test.ts`). Never use `npm test` unless asked.
- **Build**: `just build` → `bunx tsc -p tsconfig.build.json` → `dist/trac.{js,d.ts}`.
- **Playground refresh**: `just build-docs` (builds, then copies `dist/trac.js` → `docs/trac.js`).
- **Publish**: `just publish` runs test, build, `npm version patch --no-git-tag-version`, `npm publish`.

## Repo layout

- `trac.ts` — single-file interpreter. Exports `TRAC` class and `cli()` function.
- `trac.test.ts` — bun test suite. Imports `./trac.js` (TS source, `.js` extension required by `moduleResolution: node16`).
- `bin/trac.js` — Node ESM shim: `import { cli } from "../dist/trac.js"; cli();`.
- `dist/` — tsc output. Gitignored.
- `docs/` — GitHub Pages playground (`index.html`, `script.js`, `trac.js`). `docs/trac.js` is a committed copy of the build.
- `examples/*.trac` — example programs (e, pi, factorial, hanoi, rule_110).
- `info/trac.pdf`, `info/cowan/` — reference material.
- `tsconfig.json` — IDE config; includes both `trac.ts` and `trac.test.ts`.
- `tsconfig.build.json` — narrower config for publishing; includes only `trac.ts`. Build uses this so tests don't leak into `dist/`.

## Hard constraints

- **`trac.ts` must stay browser-loadable.** Do NOT add top-level `import … from "node:*"` or any Node-only bare specifier. The playground loads `docs/trac.js` (= `dist/trac.js`) directly in the browser. If you need Node APIs for CLI behaviour, use `const fs = await import("node:fs")` inside `cli()`; the dynamic import is only resolved when `cli()` runs, so the browser never touches it.

- **Cursor-based scanner, no `active.splice()` in the hot loop.** The main loop in `run()` advances `this.scan` through `this.active`; per-character mutation of the array turns the scanner O(n²). The only places that rebuild `active` are the function-value delivery sites in `_end_function_and_evaluate` (once per function call, unavoidable).

- **Builtins are allowlisted** via `TRAC.BUILTINS` (a `static readonly Set<string>`). Adding a new primitive requires both the method and an entry in the Set — without the Set entry, `#(newname,…)` returns `""`. This is deliberate: it prevents internal helpers like `_arg`, `_peek`, `constructor`, etc. from being callable as TRAC forms.

- **`package.json` `files`** is an explicit list (`dist/trac.js`, `dist/trac.d.ts`, `bin`, `examples`), not a directory glob. If shipping a new file to npm, add it explicitly.

## TRAC gotchas to remember

- **No comments in `.trac` files.** Everything read via `rs` gets re-scanned as active code, so `# foo` lines either emit the characters to neutral (which usually becomes a `ps` argument) or trigger `#(…)` parsing. Put explanations in the README, not the program.

- **Commas split arguments.** To print a literal comma, wrap in protective parens: `#(ps,(Hello, world!))'`, not `#(ps,Hello, world!)'`.

- **Meta character is `'` by default.** Records end at the meta; `rs` reads until it. `cm` changes it; `qm` returns the current one.

- **`#(…)` vs `##(…)`**: active re-scans the result, neutral appends literally. Most tests rely on this distinction — don't "normalise" one into the other.

- **Interactive I/O goes through `feedInput`**, not polling. `rc()` awaits on `_inputWaiter` when the buffer is empty; the CLI's stdin handler calls `trac.feedInput(key)` to resolve it. Don't reintroduce a `setTimeout` poll.

## When adding tests

- Tests live in `trac.test.ts` as entries in the `cases` array: `[input, expected_output]`. Output is what the `ps` callback produces; the final `neutral` buffer is discarded.
- For file-driven examples, use the `file("name.trac")` helper (reads from `examples/`).
- The output capture pattern is the canonical one:
  ```ts
  const trac = new TRAC(input, (v: string) => (out += v));
  await trac.run();
  ```

## When the user says "publish"

Pre-flight: `git status` (commit first), `npm whoami` (logged in?), `npm publish --dry-run` (inspect tarball). The Justfile's `publish` always bumps the patch; for a first release at a fresh version, either run `npm publish` directly or accept the bump.

## Style

- No emojis in code, comments, commit messages, or user-facing text unless the user asks for them.
- Commit messages follow the repo's terse lowercase style (`"add rule 110"`, `"fix readme"`). Bodies are acceptable when the change spans multiple concerns. Include the `Co-Authored-By: Claude Opus 4.7 (1M context)` trailer.
- User-facing responses: concise, no trailing summaries beyond one or two sentences on what changed.
