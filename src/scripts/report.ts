import { craftInstructions, IntensityLevels, ModelResponse } from './prompt'
import { ModelController, TOKEN_TO_CHAR_APPROXIMATION } from './model'
import { chunkString, extractJsonFromString, randomInt } from './utils'
import { AppStates, RenderController } from './render'

export type ReportData = {
  summary: {
    ideologicalStrength: IntensityLevels
    emotionalManipulationStrength: IntensityLevels
    ideologicalMarkersCount: number
    promotedValuesCount: number
    emotionalManipulationsCount: number
    logicalFallaciesCount: number
  }
  proofs: {
    ideologicalMarkers: ModelResponse['ideologicalMarkers']
    promotedValues: ModelResponse['promotedValues']
    emotionalManipulations: ModelResponse['emotionalManipulations']
    logicalFallacies: ModelResponse['logicalFallacies']
  }
}

export const ANALYSIS_CONFIG = {
  MINIMAL_RESPONSE_SIZE_IN_TOKENS: 1600,
  TOKEN_TO_CHAR_RATIO: TOKEN_TO_CHAR_APPROXIMATION,
  PROGRESS: {
    INITIAL: 0.3,
    MAX: 0.9,
    DUMMY_STEP: 0.05,
    DUMMY_INTERVAL_MS: 1000
  },
  INTENSITY: {
    NONE: 0,
    WEAK: 0.4,
    MODERATE: 0.6,
    STRONG: 0.8,
    EXTREME: 1
  } as const,
  THRESHOLDS: {
    STRONG_SIGNALS: 4,
    EXTREME_SIGNALS: 5
  }
} as const

export async function generateReport(metrics: Partial<ModelResponse>[]): Promise<ReportData> {
  const summary: ReportData['summary'] = {
    ideologicalStrength: 'NONE',
    emotionalManipulationStrength: 'NONE',
    logicalFallaciesCount: 0,
    ideologicalMarkersCount: 0,
    promotedValuesCount: 0,
    emotionalManipulationsCount: 0
  }
  const proofs: ReportData['proofs'] = {
    logicalFallacies: [],
    ideologicalMarkers: [],
    promotedValues: [],
    emotionalManipulations: []
  }

  const validMetrics = metrics.filter(
    (item): item is ModelResponse => item !== null && typeof item === 'object'
  )
  if (!validMetrics.length) {
    return { summary, proofs }
  }

  let overallIdeologicalStrength = 0
  let overallEmotionalManipulationStrength = 0

  for (const item of validMetrics) {
    overallIdeologicalStrength +=
      typeof item.ideologicalStrength === 'string'
        ? ANALYSIS_CONFIG.INTENSITY[item.ideologicalStrength]
        : 0
    overallEmotionalManipulationStrength +=
      typeof item.emotionalManipulationStrength === 'string'
        ? ANALYSIS_CONFIG.INTENSITY[item.emotionalManipulationStrength]
        : 0

    proofs.ideologicalMarkers = proofs.ideologicalMarkers.concat(item.ideologicalMarkers || [])
    proofs.promotedValues = proofs.promotedValues.concat(item.promotedValues || [])
    proofs.emotionalManipulations = proofs.emotionalManipulations.concat(
      item.emotionalManipulations || []
    )
    proofs.logicalFallacies = proofs.logicalFallacies.concat(item.logicalFallacies || [])
  }

  summary.ideologicalMarkersCount = proofs.ideologicalMarkers.length
  summary.promotedValuesCount = proofs.promotedValues.length
  summary.emotionalManipulationsCount = proofs.emotionalManipulations.length
  summary.logicalFallaciesCount = proofs.logicalFallacies.length
  summary.ideologicalStrength = getIntensityLevel(
    Math.round(overallIdeologicalStrength / validMetrics.length),
    summary.ideologicalMarkersCount
  )
  summary.emotionalManipulationStrength = getIntensityLevel(
    Math.round(overallEmotionalManipulationStrength / validMetrics.length),
    summary.emotionalManipulationsCount
  )

  return { summary, proofs }
}

export function getIntensityLevel(value: number, signalCount: number): IntensityLevels {
  const { INTENSITY, THRESHOLDS } = ANALYSIS_CONFIG

  if (
    (value >= INTENSITY.EXTREME && signalCount >= THRESHOLDS.EXTREME_SIGNALS) ||
    (value === 0 && signalCount >= THRESHOLDS.EXTREME_SIGNALS)
  ) {
    return 'EXTREME'
  }

  if (
    (value >= INTENSITY.STRONG && signalCount >= THRESHOLDS.STRONG_SIGNALS) ||
    (value === 0 && signalCount >= THRESHOLDS.STRONG_SIGNALS)
  ) {
    return 'STRONG'
  }

  if (value >= INTENSITY.MODERATE) return 'MODERATE'
  if (value >= INTENSITY.WEAK) return 'WEAK'

  return 'NONE'
}

export async function extractMetricsFromContent(
  content: string,
  model: ModelController
): Promise<ModelResponse[]> {
  const results: ModelResponse[] = []
  const renderer = RenderController.getInstance()

  const chunkSize = model.getContextWindowSize() - ANALYSIS_CONFIG.TOKEN_TO_CHAR_RATIO
  const chunks = chunkString(content, chunkSize)
  if (!chunks.length) return []

  let progressState = initializeProgress(chunks.length, renderer)

  for (let i = 0; i < chunks.length; i++) {
    renderer.transition(AppStates.analysis, {
      countOfChunks: chunks.length,
      currentChunk: i + 1
    })

    const response = await processChunk(chunks[i], model)
    if (response) {
      results.push(response)
      progressState = updateProgress(progressState, renderer)
    }
  }

  if (progressState.intervalId) {
    clearInterval(progressState.intervalId)
  }

  return results
}

export type ProgressState = {
  value: number
  step: number
  intervalId?: ReturnType<typeof setInterval>
}

export function initializeProgress(chunksCount: number, renderer: RenderController): ProgressState {
  renderer.showRequestProcessingProgressBar(ANALYSIS_CONFIG.PROGRESS.INITIAL)

  const progressState = {
    value: ANALYSIS_CONFIG.PROGRESS.INITIAL,
    step:
      ((ANALYSIS_CONFIG.PROGRESS.MAX - ANALYSIS_CONFIG.PROGRESS.INITIAL) * 10) / chunksCount / 10
  }

  return chunksCount === 1 ? startDummyProgress(progressState, renderer) : progressState
}

export function startDummyProgress(
  state: ProgressState,
  renderer: RenderController
): ProgressState {
  return {
    ...state,
    intervalId: setInterval(
      () => {
        if (state.value <= ANALYSIS_CONFIG.PROGRESS.MAX - ANALYSIS_CONFIG.PROGRESS.DUMMY_STEP) {
          state.value += ANALYSIS_CONFIG.PROGRESS.DUMMY_STEP
          renderer.showRequestProcessingProgressBar(state.value)
        }
      },
      randomInt(
        ANALYSIS_CONFIG.PROGRESS.DUMMY_INTERVAL_MS,
        ANALYSIS_CONFIG.PROGRESS.DUMMY_INTERVAL_MS * 2.5
      )
    )
  }
}

export function updateProgress(state: ProgressState, renderer: RenderController): ProgressState {
  const newValue = state.value + state.step
  renderer.showRequestProcessingProgressBar(newValue)

  return { ...state, value: newValue }
}

export async function processChunk(
  chunk: string,
  model: ModelController
): Promise<ModelResponse | null> {
  try {
    const response = await model.getCompletions({
      prompt: craftInstructions(chunk)
    })

    if (!response?.text || typeof response.text !== 'string') {
      return null
    }

    const responseTokensCount = response.text.length * ANALYSIS_CONFIG.TOKEN_TO_CHAR_RATIO
    if (responseTokensCount < ANALYSIS_CONFIG.MINIMAL_RESPONSE_SIZE_IN_TOKENS) {
      return null
    }

    return extractJsonFromString<ModelResponse>(response.text)
  } catch (error) {
    console.error('Error processing chunk:', chunk, '\n', error)
    return null
  }
}
