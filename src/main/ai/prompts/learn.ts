import type { SeedPreset } from './types'

const TUTOR_SYSTEM = `You are a patient tutor inside a flashcard app. Base everything on the student's flashcard (and note, if given). Be accurate, concise and concrete. Use Markdown, $...$ for inline maths and $$...$$ for display maths.`

const CARD_BLOCK = `Flashcard:
Q: {{front}}
A: {{back}}`

export const learnPresets: SeedPreset[] = [
  {
    builtin_key: 'learn.make_questions',
    task: 'make_questions',
    name: 'Learn questions',
    output_mode: 'json',
    system: `You turn flashcards into practice questions for a study app. Every question must be answerable from the card alone and test the card's key idea. Never reveal the answer in the question.`,
    user_template: `Deck: {{deck_name}}

For each card below, write ONE question of the requested "type". Return one item per card, with the same card_id and type.

Types:
- read_understand: "title" (a short heading) and "explanation": a short, clear explanation of the card's concept (3–6 short lines, Markdown, an example if it helps).
- multiple_choice: "question" and exactly 4 "options" with ONE correct one ("correct_index", 0–3). Distractors must be plausible and similar in length and style to the right answer, not obviously wrong. Vary the position of the correct option.
- free_answer: "question" (rephrase the card's question if needed so it stands alone) and "expected_answer": the answer written as concisely as possible, keeping every required point.
- true_false: a "statement" about the card. Make roughly half true and half subtly false (change one key detail: a number, a direction, a term). Set "is_true", and when false put the true version in "correction".
- choice_blank: the card's blanks are given in "blanks" (in order). Return "distractors": for each blank, 3 plausible wrong options of the same kind (same part of speech, same units, similar length).

Leave fields that don't apply to the type as null.

Cards (JSON):
{{cards}}

{{instructions}}`,
    is_default: true
  },
  {
    builtin_key: 'learn.make_categorize',
    task: 'make_categorize',
    name: 'Categorize',
    output_mode: 'json',
    system: `You create sorting exercises for a study app, using only the given flashcards.`,
    user_template: `Deck: {{deck_name}}

Pick 2 or 3 meaningful categories that the cards below naturally fall into (e.g. "Advantage" / "Disadvantage", or by concept). Then write 6–9 short items (max ~10 words each), taken from the cards, that each belong to exactly one category. Spread the items across categories. Set card_id to the card each item came from.

Cards (JSON):
{{cards}}

{{instructions}}`,
    is_default: true
  },
  {
    builtin_key: 'learn.mark_free_answer',
    task: 'mark_free_answer',
    name: 'Mark free answer',
    output_mode: 'json',
    system: `You are a fair examiner marking a student's short answer against a mark scheme.`,
    user_template: `${CARD_BLOCK}

Question asked: {{question}}
Expected answer: {{expected_answer}}
Required points: {{required_points}}

Student's answer:
"""
{{user_answer}}
"""

Mark it out of 10.
- Give partial credit for each required point the student got (if the question has (n) points, each is worth about 10/n).
- Ignore spelling, grammar and wording unless it changes the meaning. Accept synonyms and equivalent explanations.
- Don't give credit for vague answers that just repeat the question.
- verdict: "correct" if score >= 8, "partial" if 4–7, "wrong" if <= 3.
- points_found / points_missing: short phrases.
- short_feedback: one or two sentences, talking to the student ("you").

{{instructions}}`,
    is_default: true
  },
  {
    builtin_key: 'learn.mark_fill_blank',
    task: 'mark_fill_blank',
    name: 'Mark fill in the blank',
    output_mode: 'json',
    system: `You check a student's fill-in-the-blank answers.`,
    user_template: `Sentence: {{question}}
Expected words (in order): {{expected_answer}}
Student's words (in order): {{user_answer}}

For each blank, decide if the student's word is correct. Accept synonyms, plural/singular, and minor typos. Reject words with a different meaning. Return one entry per blank, in order.`,
    is_default: true
  },
  {
    builtin_key: 'learn.feedback_wrong',
    task: 'feedback_wrong',
    name: 'Feedback when wrong',
    output_mode: 'json',
    system: TUTOR_SYSTEM,
    user_template: `${CARD_BLOCK}

Question ({{type}}): {{question}}
Correct answer: {{expected_answer}}
The student answered: {{user_answer}}

- why_wrong: explain specifically what was wrong or missing in what THEY wrote (2–3 sentences, say "you").
- takeaways: 2–3 key takeaways, short.
- how_to_remember: one memorable tip (a mnemonic, image or link to something familiar).

{{instructions}}`,
    is_default: true
  },
  {
    builtin_key: 'learn.feedback_right',
    task: 'feedback_right',
    name: 'Feedback when right',
    output_mode: 'json',
    system: TUTOR_SYSTEM,
    user_template: `${CARD_BLOCK}

Question ({{type}}): {{question}}
Correct answer: {{expected_answer}}
The student answered correctly: {{user_answer}}

- takeaways: 2–3 key takeaways, short.
- pro_tip: one tip that deepens understanding or links it to a related idea from the card.

{{instructions}}`,
    is_default: true
  },
  {
    builtin_key: 'learn.hint',
    task: 'hint',
    name: 'Hint',
    output_mode: 'json',
    system: `You give hints in a study app. A hint nudges the student toward the answer but NEVER states the answer, any of its key words, or an obvious synonym.`,
    user_template: `${CARD_BLOCK}

Question shown to the student ({{type}}): {{question}}
Hints already given:
{{previous_hints}}

Write the next hint: one short sentence, a bit more helpful than the previous ones. Don't reveal the answer or its key words.`,
    is_default: true
  },
  {
    builtin_key: 'learn.explain',
    task: 'explain',
    name: 'Explain',
    output_mode: 'markdown',
    system: TUTOR_SYSTEM,
    user_template: `Explain this flashcard to me.

${CARD_BLOCK}

{{question}}
My last answer: {{user_answer}}

Related section of my notes:
{{source_text}}

Request: {{mode}}

Keep it focused on the card. Use short paragraphs and bullets. If asked for a diagram, include one \`\`\`mermaid block (flowchart or sequence diagram) plus a one-line caption.

{{instructions}}`,
    is_default: true
  },
  {
    builtin_key: 'learn.explain_chat',
    task: 'explain_chat',
    name: 'Explain chat',
    output_mode: 'markdown',
    system: TUTOR_SYSTEM,
    user_template: `We are discussing this flashcard.

${CARD_BLOCK}

{{question}}
My last answer: {{user_answer}}

Related section of my notes:
{{source_text}}

Conversation so far:
{{history}}

Reply to my last message. Be concise.

{{instructions}}`,
    is_default: true
  },
  {
    builtin_key: 'actions.default',
    task: 'custom_action',
    name: 'Custom action wrapper',
    output_mode: 'markdown',
    system: TUTOR_SYSTEM,
    user_template: `{{action_prompt}}`,
    is_default: true
  }
]

export const seedActions = [
  {
    builtin_key: 'action.eli12',
    name: "Explain like I'm 12",
    icon: 'baby',
    model: 'sonnet',
    output: 'markdown' as const,
    placements: ['card', 'note_selection', 'learn_question', 'after_answer'] as const,
    prompt: `Explain this like I'm 12 years old. Use everyday words, one short analogy and a tiny example. Keep it under 120 words.\n\nQ: {{front}}\nA: {{back}}\n{{source_text}}`
  },
  {
    builtin_key: 'action.exam_question',
    name: 'Exam-style question',
    icon: 'graduation-cap',
    model: 'sonnet',
    output: 'markdown' as const,
    placements: ['card', 'note_selection', 'after_answer'] as const,
    prompt: `Write one exam-style question on this, with marks in brackets, then a mark scheme with one bullet per mark.\n\nQ: {{front}}\nA: {{back}}\n{{source_text}}`
  },
  {
    builtin_key: 'action.real_world',
    name: 'Real-world example',
    icon: 'globe',
    model: 'sonnet',
    output: 'markdown' as const,
    placements: ['card', 'note_selection', 'learn_question', 'after_answer'] as const,
    prompt: `Give one concrete real-world example of this, and say in one line how it connects to the concept.\n\nQ: {{front}}\nA: {{back}}\n{{source_text}}`
  },
  {
    builtin_key: 'action.mnemonic',
    name: 'Mnemonic',
    icon: 'brain',
    model: 'sonnet',
    output: 'markdown' as const,
    placements: ['card', 'note_selection', 'after_answer'] as const,
    prompt: `Make a short, memorable mnemonic for this (acronym, rhyme or vivid image), and explain how each part maps to the answer.\n\nQ: {{front}}\nA: {{back}}\n{{source_text}}`
  }
]
