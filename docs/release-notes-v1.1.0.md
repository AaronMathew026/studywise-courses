## What's new

**Ollama as an AI provider.** Settings > AI provider switches every AI feature between Claude Code and Ollama, either Ollama Cloud (with an API key) or a local server. You can pick models per task and per deck.

**Anki import.** Open `.apkg` and `.colpkg` files, old and current formats: cloze cards, maths, images, tags, subdecks and (optionally) your review progress. Drop one on the window or use the import menu.

**Course flashcards by week.** Each course gets a folder in Decks with one deck per week. Existing courses are sorted into week decks automatically, keeping their review history.

**Retest wrong answers.** In Flashcards, Learn and course topics, a card or question you get wrong comes back three items later until you get it right. Retries don't change your schedule or your score.

**Move to another computer.** Settings > General exports your whole library to a `.studywise` file that opens on Mac and Windows, with your progress if you tick "Include my progress".

**Notes made automatically.** Writing a course topic saves its notes, with slide figures, into a folder for the course.

**Live progress.** Generating shows real stages (reading files, thinking, writing each section) in a progress dock on every page. Jobs moved into Settings.

**Windows.** A back button in the top-left corner, plus Alt+Left/Right and the mouse's back and forward buttons. Installing from source no longer needs Visual Studio.

**Polish.** Dialogs, menus, the Explain panel and notifications animate out instead of vanishing. Notifications move out of the way of open dialogs. The nav bar fits its links to the space it actually has, and several pages behave better in narrow windows.

## Download

This release has a Windows build only: download `Studywise-Courses-win-x64.zip`, unzip it, and run `Studywise Courses.exe`. On a Mac, build it from source with `npm install && npm run dist`.

You need Claude Code installed and logged in, or an Ollama server or Ollama Cloud key:

```
npm install -g @anthropic-ai/claude-code
claude
```

The app isn't signed. On Windows, click More info, then Run anyway. The Windows build hasn't been tested on a real Windows machine yet.
