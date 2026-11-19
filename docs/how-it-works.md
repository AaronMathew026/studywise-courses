# How Studywise works

## Talking to Claude

Every AI feature goes through one function, `runAI()` in `src/main/ai/`. It looks up the task's prompt and model, fills in the template, runs Claude Code, and checks what comes back.

Each call is `claude -p` in a new empty temp folder: prompt on stdin, `stream-json` output, no tools, limited turns, and no user settings or MCP servers. Structured tasks use `--json-schema` and the result is checked again with zod (one retry with the error if it doesn't fit). PDFs are the only exception to "no tools": the file is copied into the temp folder and only the read-only `Read` tool is allowed, so Claude sees the real pages, images included.

`ANTHROPIC_API_KEY` and similar variables are removed from the environment, so calls always use your Claude login and never an API account. Apps opened from Finder don't get your shell's `PATH`, so on startup Studywise asks your login shell for it, then also checks `~/.claude/local`, `~/.local/bin`, Homebrew, `/usr/local/bin` and npm's global bin. Settings → Claude Code shows what it found and lets you pick the binary yourself.

Calls run three at a time, time out after 120 seconds (15 minutes for generation), and retry once on network or overload errors. Each one is logged with its task, prompt version, model, time and tokens under Settings → AI usage. The plan-usage numbers Claude Code reports (5-hour and weekly) are shown in the top bar.

Long jobs (generating notes or cards) run in the main process. Closing the window doesn't stop them, you get a notification when one finishes, and the Jobs page can cancel them.

### On Windows

GUI apps get the full user PATH, so Studywise just looks there and in `%APPDATA%\npm` and `~\.local\bin`. npm installs `claude` as a `claude.cmd` shim, which can't be started without a shell, so Studywise runs the package's `cli.js` with `node.exe` directly. The native installer's `claude.exe` runs as is. The window uses Windows' own caption buttons, shortcuts show as Ctrl/Alt/Shift, and closing the window quits the app once no job is running. Data lives in `%APPDATA%\Studywise`.

## Notes and flashcards

PDFs are split into 8-page chunks. For notes, each chunk is told what's already been written and the pieces are joined into one note that streams into the editor. Picking several sources switches to the "Linking texts" preset, which sends them in one call so they can be compared.

Cards come back in the StudySmarter text format (below). If a reply gets cut off, the half-finished card is dropped and Claude is told to "continue" in the same session, up to 10 times, with duplicates removed. Every card is checked: the `(n)` in a question has to match the number of bullets, fill-in-the-blank cards need one answer per blank and no `(n)`, and empty sides, duplicates and missing separators are flagged. Anything flagged gets a **Fix with AI** button in the preview.

## Learn mode

Each card becomes one of eight question types: Read & understand, Multiple choice, Free answer, True or false, Match pairs, Categorize, Fill in the blank and Choice blank. Blanks come from `___` in cloze cards or **bold** words in an answer. Questions are made eight cards per call when the session starts, the next batch is fetched ahead of time, and each question is cached per card and type until the card or prompt changes.

Multiple choice, true/false, match pairs, categorize and choice blank are marked in code. Free answers are scored out of 10 by Claude against the card, with credit per required point (8+ correct, 4–7 partly right, 3 or less wrong; you can change these). Fill in the blank checks for an exact match first and only asks Claude about the blanks that don't match. Every result can be overridden with "I was right".

Feedback (why your answer was wrong, takeaways, a way to remember it) loads in the background after each answer. Hints come from the card first, then Claude, two at most, and never give away the answer.

Explain only runs when you ask. Open it on a card, a feedback panel or selected note text, then choose Explain, Simpler, Go deeper, Example, Diagram or Why was I wrong, or type a question. The answer can be saved to the card or turned into new cards.

## Models

Settings → Models sets a model and effort level for each task, with a Test button. Defaults: opus for notes; haiku for marking blanks, hints and the quick note edits; sonnet for everything else. A deck can override any of these, and its "extra instructions" are added to every prompt for that deck.

## Prompts and custom actions

Every task's prompts live in Settings → Prompts. You can edit them, see exactly what Claude will receive, test-run them, duplicate them, set a default, view the history with a diff, and reset built-ins. For JSON tasks the output format is added by the app, so a prompt edit can't break parsing.

Custom actions are your own AI buttons: a name, a prompt, a model, whether the result is Markdown or new cards, and where the button shows up (cards, note selection, Learn questions, after answering). Presets and actions export and import together as JSON.

## Spaced repetition

Two schedulers, switchable in Settings → General.

**Difficulty-based (default)**, modelled on real scheduling data: cards start at difficulty 0.60 with three 1-day steps, then intervals grow quickly (roughly 3, 8, 20, 115, 280 days and on) and shrink for harder cards. A card comes back after `interval × (0.694 − 0.187 × difficulty)` days. Success lowers difficulty, and forgetting a card sends it back to relearning.

**SM-2**: ease starts at 2.5, intervals go 1, 6, then interval × ease.

Flashcard mode uses Again / Hard / Good / Easy, Learn results feed the same schedule, and the Dock badge shows how many cards are due today.

## Import and export

- **StudySmarter text**: `question/#*#/answer`, with cards separated by a line that's just `#`. A trailing `(n)` sets the required points, and `___` runs make a cloze card whose answers are the `- ` bullets. Round-trips exactly.
- **StudySmarter Excel**: Question, Answer A–F each followed by its "answer is correct" flag (TRUE/FALSE, `=TRUE()`, true/false or 1/0), then Tags, Hints and Explanation. A normal card exports as Answer A marked TRUE.
- Deck JSON and CSV.
- Notes from Markdown files or a Notion export zip, keeping Module, Type and Week. Notes export as Markdown.

PDF, Word and PowerPoint files can be dropped on the window or the Dock icon, or opened with **Open With → Studywise**.

## Shortcuts

There are a lot. `?` lists them all and `⌘K` searches everything. The main ones:

| | |
|---|---|
| `⌘N`, `⇧⌘N`, `⌥⌘N` | new card, note, deck |
| `⌘G`, `⇧⌘G` | generate flashcards, notes |
| `⌘L`, `⌘Y` | Learn, flashcards |
| `⌘E` | explain |
| `Space`, `1`–`4`, `↩` | flip, rate, submit |
| `h`, `s`, `r` | hint, skip, I was right |
| `g` then `d` / `n` / `s` | go to decks, notes, settings |
| `j`, `k`, `x`, `e` | move, select, explain in a card list |

## Your data

Everything is in `~/Library/Application Support/Studywise/` (on Windows, `%APPDATA%\Studywise`): the SQLite database, pasted images, a cache and logs. Settings → General can open the folder, back the whole library up to a zip, and restore it (the old database is kept alongside).

## Environment variables

| | |
|---|---|
| `AI_MOCK=1` | canned output for every AI task (used by tests) |
| `STUDYWISE_DATA_DIR` | use a different data folder |
| `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | signing and notarization at build time |

## Code layout

`src/main` is the Electron main process: database, Claude bridge, jobs, import/export and IPC. `src/preload` exposes `window.studywise.<area>.<method>()` to the page. `src/renderer` is the React UI. `src/shared` has the types, the StudySmarter parser, the schedulers, marking and the keymap. The page runs sandboxed with context isolation, a strict CSP and no remote content, and every IPC message is checked with zod.

Other scripts: `npm run ai:real-check` (one real call per task, plus notes and cards from a 12-page PDF), `node scripts/packaged-check.mjs` (a real generation through a built app with a Finder-like PATH), `npm run icons`, and `node scripts/screenshots.mjs [--dark]`.
