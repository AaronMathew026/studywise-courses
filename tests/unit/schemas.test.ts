import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { TASK_SCHEMAS, jsonSchemaFor } from '../../src/main/ai/schemas'
import { QuestionPayloads, AiQuestionBatch, FreeAnswerMark, FeedbackWrong, FeedbackRight, GeneratedCards, AiCategorize, FillBlankMark, HintOut } from '@shared/questions'
import { CardInput, LearnSettings, CustomAction, Deck } from '@shared/types'
import { mockResponse } from '../../src/main/ai/mock'
import type { TaskId } from '@shared/tasks'

describe('zod schemas', () => {
  it('every json task has a schema that converts to JSON Schema', () => {
    for (const task of Object.keys(TASK_SCHEMAS) as TaskId[]) {
      const js = jsonSchemaFor(task)
      expect(js.type).toBe('object')
    }
  })
  it('mock output for every json task passes its schema', () => {
    const cards = JSON.stringify([
      { card_id: 'a', type: 'multiple_choice', front: 'Q', back: 'A' },
      { card_id: 'b', type: 'true_false', front: 'Q2', back: 'A2' },
      { card_id: 'c', type: 'choice_blank', front: 'Q3', back: '**x**', blanks: ['x'] },
      { card_id: 'd', type: 'read_understand', front: 'Q4', back: 'A4' },
      { card_id: 'e', type: 'free_answer', front: 'Q5', back: 'A5' }
    ])
    for (const task of Object.keys(TASK_SCHEMAS) as TaskId[]) {
      const m = mockResponse(task, 'json', { cards, count: 2, front: 'q', back: 'a', expected_answer: 'a | b', user_answer: 'a | c' }, '')
      const r = TASK_SCHEMAS[task]!.safeParse(m.structured)
      expect(r.success, `${task}: ${r.success ? '' : r.error.message}`).toBe(true)
    }
  })
  it('question payloads accept good and reject bad data', () => {
    expect(QuestionPayloads.multiple_choice.safeParse({ question: 'q', options: ['a', 'b', 'c', 'd'], correct_index: 1 }).success).toBe(true)
    expect(QuestionPayloads.multiple_choice.safeParse({ question: 'q', options: ['a', 'b'], correct_index: 1 }).success).toBe(false)
    expect(QuestionPayloads.categorize.safeParse({ categories: ['A'], items: [] }).success).toBe(false)
    expect(QuestionPayloads.true_false.safeParse({ statement: 's', is_true: true }).success).toBe(true)
    expect(QuestionPayloads.fill_blank.safeParse({ segments: [{ type: 'blank', value: 'x' }], answers: ['x'] }).success).toBe(true)
    expect(QuestionPayloads.match_pairs.safeParse({ pairs: [{ left: 'a', right: 'b', card_id: 'c' }] }).success).toBe(false)
  })
  it('AI output schemas', () => {
    expect(FreeAnswerMark.safeParse({ score: 11, verdict: 'correct', points_found: [], points_missing: [], short_feedback: '' }).success).toBe(false)
    expect(FeedbackWrong.safeParse({ why_wrong: 'x', takeaways: ['a'], how_to_remember: 'y' }).success).toBe(true)
    expect(FeedbackRight.safeParse({ takeaways: [], pro_tip: 'y' }).success).toBe(false)
    expect(GeneratedCards.safeParse({ cards: [{ front: 'a', back: 'b' }] }).success).toBe(true)
    expect(AiCategorize.safeParse({ categories: ['a', 'b', 'c', 'd'], items: [] }).success).toBe(false)
    expect(FillBlankMark.safeParse({ blanks: [{ correct: true }] }).success).toBe(true)
    expect(HintOut.safeParse({}).success).toBe(false)
    expect(AiQuestionBatch.safeParse({ questions: [{ card_id: 'x', type: 'free_answer', question: 'q', expected_answer: 'a' }] }).success).toBe(true)
  })
  it('domain schemas apply defaults', () => {
    const c = CardInput.parse({ deck_id: 'd' })
    expect(c).toMatchObject({ format: 'term_definition', kind: 'regular', tags: [], options: [] })
    expect(LearnSettings.parse({}).sessionLength).toBe(20)
    expect(CustomAction.parse({ id: '1', name: 'n', prompt: 'p' }).placements).toEqual(['card'])
    expect(Deck.safeParse({}).success).toBe(false)
    expect(z.toJSONSchema(CardInput)).toBeTruthy()
  })
})
