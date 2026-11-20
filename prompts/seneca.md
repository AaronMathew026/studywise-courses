# Course prompts

The three prompts from the original `seneca.md` are now built into the app:

| Prompt | Task in Settings → Prompts / Models | Code |
|---|---|---|
| Outline | Course: plan topics (`course_outline`) | [src/main/ai/prompts/course.ts](../src/main/ai/prompts/course.ts) |
| Topic | Course: write a topic (`course_topic`) | same file |
| Marking | Course: mark an explain answer (`course_mark`) | same file |

Edit them in Settings → Prompts; the app keeps a version history and can reset them. The JSON output format is added by the app from the schemas in [src/shared/course.ts](../src/shared/course.ts), so editing a prompt can't break parsing.

## Changes from the original

- **Weeks.** The outline runs once per week, on that week's files only. It's given the topics earlier weeks already cover, told not to repeat them, and can list them in `needs`. Topic ids are course-wide: `w2t3` is week 2, topic 3.
- **Topic prompt uses the outline's section headings** (it can split one that's too long).
- **Benefits | Disadvantages table only where the topic has real pros and cons.**
- **No repeated question type across a section boundary** either.
- **wrong_word:** the wrong word must be a single word that appears only once in the sentence. The app drops any that don't.
- **Figures:** `page` is the page within the attached PDF. The app sends each topic only the pages its outline points at, and maps the page back to the original slide.
- **match** pairs are `{ "term", "meaning" }` objects and **sort** items are `{ "item", "bucket" }` objects, not arrays.
- Questions that can't be asked as written (wrong option count, a sort item in no bucket, and so on) are dropped rather than failing the whole topic.

## How the app uses the output

- **Learning a topic:** one section at a time: notes, then the figure (rendered from the PDF page), then that section's questions. After the last section comes the topic check.
- **Random recall:** after a section, a 1 in 4 chance of one recall card from a different topic you've started, in any week. Due or never-reviewed cards come first, and the same card isn't repeated in a session. You type it or just think it, then press "Didn't know" or "Knew it", which feeds spaced repetition.
- **Saving tokens:** each topic call gets only its own week's files, cut to the pages its `sources` list.
