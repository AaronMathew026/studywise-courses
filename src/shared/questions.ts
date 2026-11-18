import { z } from 'zod'
import type { QuestionType } from './types'
import type { BlankSegment } from './blanks'

export const ReadUnderstandQ = z.object({ title: z.string().default(''), explanation: z.string().min(1) })
export const MultipleChoiceQ = z.object({
  question: z.string().min(1),
  options: z.array(z.string().min(1)).length(4),
  correct_index: z.number().int().min(0).max(3)
})
export const FreeAnswerQ = z.object({ question: z.string().min(1), expected_answer: z.string().min(1) })
export const TrueFalseQ = z.object({ statement: z.string().min(1), is_true: z.boolean(), correction: z.string().default('') })
export const MatchPairsQ = z.object({
  pairs: z.array(z.object({ left: z.string(), right: z.string(), card_id: z.string() })).min(2)
})
export const CategorizeQ = z.object({
  categories: z.array(z.string().min(1)).min(2).max(3),
  items: z.array(z.object({ text: z.string().min(1), category: z.string().min(1), card_id: z.string().optional() })).min(4).max(12)
})
const Segment = z.object({ type: z.enum(['text', 'blank']), value: z.string() })
export const FillBlankQ = z.object({ prompt: z.string().default(''), segments: z.array(Segment), answers: z.array(z.string()).min(1) })
export const ChoiceBlankQ = FillBlankQ.extend({ choices: z.array(z.array(z.string()).min(2)) })

export const QuestionPayloads = {
  read_understand: ReadUnderstandQ,
  multiple_choice: MultipleChoiceQ,
  free_answer: FreeAnswerQ,
  true_false: TrueFalseQ,
  match_pairs: MatchPairsQ,
  categorize: CategorizeQ,
  fill_blank: FillBlankQ,
  choice_blank: ChoiceBlankQ
} as const

export type PayloadOf<T extends QuestionType> = z.infer<(typeof QuestionPayloads)[T]>

export type LearnQuestion = {
  [K in QuestionType]: { id: string; type: K; card_id: string; card_ids: string[]; payload: PayloadOf<K>; cached: boolean }
}[QuestionType]

// What the AI returns for one card in a batch (flat, so one JSON schema covers all types).
export const AiQuestionItem = z.object({
  card_id: z.string(),
  type: z.enum(['read_understand', 'multiple_choice', 'free_answer', 'true_false', 'choice_blank']),
  title: z.string().nullable().optional(),
  explanation: z.string().nullable().optional(),
  question: z.string().nullable().optional(),
  options: z.array(z.string()).nullable().optional(),
  correct_index: z.number().int().nullable().optional(),
  expected_answer: z.string().nullable().optional(),
  statement: z.string().nullable().optional(),
  is_true: z.boolean().nullable().optional(),
  correction: z.string().nullable().optional(),
  distractors: z.array(z.array(z.string())).nullable().optional()
})
export type AiQuestionItem = z.infer<typeof AiQuestionItem>
export const AiQuestionBatch = z.object({ questions: z.array(AiQuestionItem) })

export const AiCategorize = z.object({
  categories: z.array(z.string()).min(2).max(3),
  items: z.array(z.object({ text: z.string(), category: z.string(), card_id: z.string().nullable().optional() })).min(4).max(12)
})

// ---- answers + marks ----
export type LearnAnswer =
  | { type: 'read_understand' }
  | { type: 'multiple_choice'; index: number }
  | { type: 'true_false'; value: boolean }
  | { type: 'free_answer'; text: string }
  | { type: 'match_pairs'; mapping: Record<number, number> } // left index -> right index (in original pair order)
  | { type: 'categorize'; assignments: Record<number, string> }
  | { type: 'fill_blank'; values: string[] }
  | { type: 'choice_blank'; values: string[] }

export type Verdict = 'correct' | 'partial' | 'wrong'

export interface Mark {
  score: number // 0..10
  verdict: Verdict
  detail?: {
    points_found?: string[]
    points_missing?: string[]
    short_feedback?: string
    blanks?: boolean[]
    wrongItems?: number[]
  }
  by: 'code' | 'ai'
}

export const FreeAnswerMark = z.object({
  score: z.number().min(0).max(10),
  verdict: z.enum(['correct', 'partial', 'wrong']),
  points_found: z.array(z.string()),
  points_missing: z.array(z.string()),
  short_feedback: z.string()
})
export type FreeAnswerMark = z.infer<typeof FreeAnswerMark>

export const FillBlankMark = z.object({
  blanks: z.array(z.object({ correct: z.boolean(), reason: z.string().optional() }))
})

export const FeedbackWrong = z.object({
  why_wrong: z.string(),
  takeaways: z.array(z.string()).min(1).max(4),
  how_to_remember: z.string()
})
export const FeedbackRight = z.object({ takeaways: z.array(z.string()).min(1).max(4), pro_tip: z.string() })
export const HintOut = z.object({ hint: z.string() })

export const GeneratedCard = z.object({
  front: z.string(),
  back: z.string(),
  options: z
    .array(z.object({ text: z.string(), correct: z.boolean() }))
    .nullable()
    .optional(),
  tags: z.array(z.string()).nullable().optional(),
  hints: z.array(z.string()).nullable().optional(),
  language: z.string().nullable().optional()
})
export const GeneratedCards = z.object({ cards: z.array(GeneratedCard) })
export type GeneratedCard = z.infer<typeof GeneratedCard>

export function segmentsToPrompt(segments: BlankSegment[]): string {
  return segments.map((s) => (s.type === 'blank' ? '_____' : s.value)).join('')
}
