import { notePresets } from './notes'
import { cardPresets } from './cards'
import { learnPresets, seedActions } from './learn'
import type { SeedPreset } from './types'

export const SEED_PRESETS: SeedPreset[] = [...notePresets, ...cardPresets, ...learnPresets]
export const SEED_ACTIONS = seedActions
export type { SeedPreset }
