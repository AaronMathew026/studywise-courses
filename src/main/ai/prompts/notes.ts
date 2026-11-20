import type { SeedPreset } from './types'

const NOTES_SYSTEM = `You write study notes for a university student. You follow the student's style rules exactly and only use what is in the source they give you. Output Markdown only, with no preamble and no closing remarks. Use $...$ for inline maths and $$...$$ for display maths, and \`\`\`mermaid code blocks only if a diagram genuinely needs one.`

export const MY_NOTES = `Write study notes on the attached source in my personal style, described below. The notes will later be turned into flashcards where everything is examinable. So cover everything important in the source, in its order, accurately, and don't add facts that aren't in it. Leave out anything the source itself marks as not examinable: parts the slides or the lecturer call non-examinable, not assessed, optional, extra reading, "for interest only" or "won't be on the exam". If you're not sure, keep it. The only exception is a one-line analogy for an abstract idea when the source gives no example; start it with "Think of it like" so it's clearly an analogy.

The note's title is {{title}}. Metadata (Module {{module}}, Type {{type}}, Week {{week}}) is stored separately, so don't write it in the body.

VOICE
- Plain, simple and casual, like explaining to a classmate. Use "you" and "we".
- Short lines and fragments. Lines often start lowercase and usually have no full stop.
- Use "basically", "made simple", "Imagine...", "Think of it as..." naturally, not on every line.
- Explain jargon in simple words, but keep key terms and definitions exact.
- Never write "according to the text", page numbers, module codes or week numbers.

STRUCTURE
- No intro paragraph. Open with "What is X?" or "The main idea:" and give the core idea in 1–2 lines.
- Headings (##) are questions or short labels ending in a colon, e.g. "Why does software become worse over time?", "The three important definitions:", "Cue vs Information Scent:", "The 6 steps:". If the source lists a set, put the count in the heading ("The 9 important IFT constructs:").
- Each key term gets a bold sub-heading ending in a colon (**Forager:**), then 1–2 bullets with a simple definition.
- Bullets use "- ", with nested sub-bullets for explanation or examples. Keep them short.
- Processes and methods are a numbered list, one step per line, with a sub-bullet if a step needs explaining.
- For "X vs Y:" sections, give a one-line punchy contrast first ("Cue is the clue, the scent is the judgement"), then a line for each side, then an "Imagine..." example that shows the difference, ending in YES/NO lines where that fits (e.g. "Preservation: YES — it behaves the same.").
- Use the source's own examples as concrete scenarios: "Imagine a team builds a java system...", "For example:". Walk through worked examples step by step.
- Put code in code blocks, followed by a "Code | Simple meaning" table explaining each line.
- Use tables often:
  - Benefits | Limitations (or Benefits | Disadvantages): two columns, short items
  - Benefit | Explanation, or Disadvantage | Explanation
  - Term | Simple meaning: for lists of terms, rules, primitives, options, variables
  - Example | Category? | Why?: classifying examples (e.g. Change | Refactoring? | Why?)
  - Approach | Advantage | Disadvantage: trade-offs
  - Researcher | What to remember: when several authors or ideas are named
  - Test | Expected result: for specifications and testing
  - Wrong idea | Correct idea: common misreadings of the text, near the end
- Name authors and what they argue ("Thorpe's main argument is that...", "Pirolli suggested three important ideas:").
- After a section, add a one-line takeaway where it helps: "The trade off is that:", "The main benefit is... and the main disadvantage is...", "Remember: ...", "IMPORTANT CONNECTION:", or a short bold line such as "**Passing tests is evidence of correctness, not proof**".
- Never write "see diagram". Turn every diagram, figure, table and image in the source into words, a list or a table (what the boxes, arrows, axes and labels show).
- End with the source's limitations, future research or open questions if it has any. No summary paragraph at the end.

STYLE EXAMPLE (match this feel, not this content)
## Cue vs Information Scent:
Cue is the clue, the scent is the judgement
Cue is what the link tells you
Scent is how useful the link will be
## There are three choices a forager makes:
- Process
  - Stay in your current patch and read the information
- Move
  - Follow a link to another patch

{{instructions}}
Output the notes as Markdown only.`

export const LINKING_TEXTS = `Write a note linking the attached texts, in the same voice and formatting rules as my normal notes: plain, casual, short lines, question-style headings ending in colons, "- " bullets with sub-bullets, tables where useful. The title is "Linking all {{title}} texts". Structure:
1. A bullet per text: "T1: <what it's about in one line>", T2, T3...
2. "What is each text about?": a bold "T1: <short claim>:" heading for each text, with one bullet explaining it.
3. "The recurring themes, made simple:": several "Theme n: <theme>:" sections. Under each, give T1/T2/T3 bullets with sub-bullets. If a text doesn't cover the theme, say "doesn't focus on <theme>". End each theme with one plain synthesis line ("All three show..." / "T1 and T2 agree that...").
4. Add an "IMPORTANT CONNECTION:" block where the link between the texts is strongest, with one line per text and a one-line conclusion.
5. "Agree, extend and disagree:": sub-headings as short labels or questions ("Social cost of asking:", "Should developers ask more often?"). Each says which texts agree, which extends which, or which disagree, with a bullet per text and a one-line conclusion.
Only use what's in the texts. {{instructions}}
Output Markdown only.`

const QUICK_SYSTEM = `You edit a student's study notes. Keep their casual voice, Markdown structure, KaTeX maths ($...$) and any tables. Never invent facts. Output only the rewritten Markdown, with no preamble.`

export const notePresets: SeedPreset[] = [
  { builtin_key: 'notes.my_notes', task: 'generate_notes', name: 'My notes', output_mode: 'markdown', system: NOTES_SYSTEM, user_template: MY_NOTES, is_default: true },
  { builtin_key: 'notes.linking_texts', task: 'generate_notes', name: 'Linking texts', output_mode: 'markdown', system: NOTES_SYSTEM, user_template: LINKING_TEXTS, is_default: false },
  {
    builtin_key: 'note.simplify',
    task: 'note_simplify',
    name: 'Simplify',
    output_mode: 'markdown',
    system: QUICK_SYSTEM,
    user_template: `Rewrite this part of my notes so it is simpler and easier to understand. Use plain words and short lines, explain any jargon, but keep every key term and definition exact.\n\n{{instructions}}\n\nTEXT:\n{{source_text}}`,
    is_default: true
  },
  {
    builtin_key: 'note.shorten',
    task: 'note_shorten',
    name: 'Shorten',
    output_mode: 'markdown',
    system: QUICK_SYSTEM,
    user_template: `Make this part of my notes shorter. Cut repetition and filler but keep every examinable fact, definition, number and example.\n\n{{instructions}}\n\nTEXT:\n{{source_text}}`,
    is_default: true
  },
  {
    builtin_key: 'note.fix_formatting',
    task: 'note_fix_formatting',
    name: 'Fix formatting',
    output_mode: 'markdown',
    system: QUICK_SYSTEM,
    user_template: `Fix the Markdown formatting of this text: consistent "- " bullets and nesting, "##" headings ending in a colon, tidy tables, maths in $...$, code in code blocks. Don't change the wording unless it's broken.\n\n{{instructions}}\n\nTEXT:\n{{source_text}}`,
    is_default: true
  },
  {
    builtin_key: 'note.expand',
    task: 'note_expand',
    name: 'Expand',
    output_mode: 'markdown',
    system: QUICK_SYSTEM,
    user_template: `Expand this part of my notes (title: {{title}}). Add a simple explanation under each point, an "Imagine..." example where it helps, and a one-line takeaway. Stay accurate; if you add an analogy start it with "Think of it like".\n\n{{instructions}}\n\nTEXT:\n{{source_text}}`,
    is_default: true
  }
]
