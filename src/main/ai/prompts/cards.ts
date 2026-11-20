import type { SeedPreset } from './types'

export const EXAM_FLASHCARDS = `You are making flashcards from the attached PDF of my notes. Everything in the notes, including text inside images, diagrams, tables and graphs, is strictly examinable, except anything the notes themselves mark as not examinable (non-examinable, not assessed, optional, extra reading, "for interest only", "won't be on the exam"): make no cards for that. Use only what is in the notes: don't add outside facts, and don't skip anything else. If you're not sure whether something is examinable, make the card.

OUTPUT FORMAT (exact; it gets pasted straight into StudySmarter's text import)
- Each card is: question/#*#/answer
- Between cards, put a line containing only: #
- Output ONLY the cards in one plain-text code block. No title, no numbering, no headings, no commentary before or after.
- Example:
What is the work function?/#*#/the minimum energy needed to remove an electron from the surface of a metal
#
Explain why a threshold frequency exists (2)/#*#/- below the threshold frequency, photons have less energy than the work function

- so they do not have enough energy to remove an electron
#
Each electron can only absorb _________/#*#/one photon of energy

MULTI-POINT ANSWERS
- If an answer has more than one point, item or step, put each one on its own line starting with "- ", with a blank line between bullets.
- Put the number of bullets in brackets at the end of the question, e.g. "Describe how a GM tube works (4)". The number must equal the number of bullets exactly.
- Single-point answers get no number and no bullet.

ANSWER STYLE
- Short and to the point: fragments, not full sentences. Usually start lowercase and don't end with a full stop.
- Copy definitions, laws and key phrases word for word from my notes.
- Never write "according to the notes", "in this lecture", or course codes, week numbers or page numbers.
- Write equations as plain text with symbols, e.g. E = hf, λ = h/mv, 1.6 × 10⁻¹⁹ C. Always give units when the notes do.

QUESTION STYLE
- Atomic: one fact or idea per card. Split big ideas into several cards.
- Test the same fact from several angles: a direct question, a reverse question, and a fill-in-the-blank or "what happens when..." version.
- Mix these types, wherever the notes support them:
  - "What is...?" / "What are...?"
  - "Define..."
  - "State..." (laws, rules, conditions)
  - "Describe... (n)" / "Explain... (n)" (processes, experiments, reasoning chains, with bullets in order)
  - "What is the equation for...?", "What are the units for...?", "What does [symbol] stand for in [equation]?"
  - "Name the [N]..." (lists)
  - "What is the difference between X and Y? (n)"
  - "What happens when/if...?" (cause and effect)
  - "Why...?"
  - Fill-in-the-blank: replace key words in a sentence from the notes with ________ (one run of underscores per blank). The answer lists the missing words in order, each as a "- " bullet with a blank line between. Don't add a (n) number to fill-in-the-blank questions.
  - "Draw/Sketch/Label [diagram or graph]": the answer describes the key features in "- " bullets (shape, axes, labels, key points), with a (n) number.
- Make every question make sense on its own in a shuffled deck. If a question could be ambiguous, add context in brackets, e.g. "(photoelectric effect)" or "(capacitors)".

COVERAGE
- Go through the notes in order, start to finish. Every definition, law, equation, symbol, unit, constant, value, list, process, experiment, comparison, example, advantage/disadvantage, graph and diagram gets at least one card.
- Read all text inside images (labels, annotations, tables, axes) and make cards from it too.
- If you run out of space, stop at the end of a complete card. When I say "continue", carry on from exactly where you stopped, with no repeats and no restarting.

{{instructions}}`

const CARD_SYSTEM = `You make flashcards for a university student. Only use facts from the material you are given. Follow the output format exactly.`

export const STANDARD_CARDS = `Make flashcards from the source material for the deck "{{deck_name}}".

Format: {{format}}
Card type: {{card_type}}
Number of cards: {{count}}
{{language}}

Rules:
- Skip anything the source marks as not examinable (non-examinable, not assessed, optional, extra reading, "for interest only", "won't be on the exam"). If you're not sure, keep it.
- One idea per card. Questions must make sense on their own in a shuffled deck.
- term_definition: front is the term, back is a short, exact definition.
- question_answer: front is a question, back a concise answer. Use "- " bullets for multi-part answers and put the number of bullets in brackets at the end of the question, e.g. "(3)".
- vocabulary: front is the word or phrase, back is its translation into the second language, with a short usage example where useful.
- multiple_choice: give 4 options with exactly one correct (set correct: true); "back" holds the correct answer text. Distractors must be plausible.
- Use $...$ for maths. Put **bold** around the key word(s) of each answer so they can be used for fill-in-the-blank practice.
- Add 1–2 short tags per card.

{{instructions}}`

export const cardPresets: SeedPreset[] = [
  { builtin_key: 'cards.exam_style', task: 'generate_cards', name: 'Exam flashcards (my style)', output_mode: 'studysmarter_text', system: CARD_SYSTEM, user_template: EXAM_FLASHCARDS, is_default: true },
  { builtin_key: 'cards.standard', task: 'generate_cards', name: 'Standard cards', output_mode: 'json', system: CARD_SYSTEM, user_template: STANDARD_CARDS, is_default: false },
  {
    builtin_key: 'cards.fix',
    task: 'fix_cards',
    name: 'Fix card',
    output_mode: 'json',
    system: CARD_SYSTEM,
    user_template: `Fix this flashcard. Keep the same fact and the same style; only change what is needed.

Problem: {{problem}}

Rules for the StudySmarter style:
- Multi-point answers use "- " bullets, one per line, with a blank line between bullets, and the question ends with the bullet count in brackets, e.g. (3). The count must equal the bullets.
- Fill-in-the-blank questions use one run of underscores (________) per blank, have no (n), and the answer lists the missing words in order as "- " bullets (or just the word if there is one blank).
- Neither side may be empty.

Question:
{{front}}

Answer:
{{back}}

{{instructions}}

Return exactly one card in "cards".`,
    is_default: true
  }
]
