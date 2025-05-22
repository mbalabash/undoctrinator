import {
  generateReport,
  getIntensityLevel,
  extractMetricsFromContent,
  initializeProgress,
  startDummyProgress,
  updateProgress,
  processChunk,
  ANALYSIS_CONFIG
} from '../src/scripts/report'
import { ModelResponse } from '../src/scripts/prompt'
import { ModelController } from '../src/scripts/model'
import { AppStates, RenderController } from '../src/scripts/render'
import { chunkString } from '../src/scripts/utils'

jest.mock('../src/scripts/model', () => {
  return {
    ModelController: jest.fn().mockImplementation(() => {
      return {
        getContextWindowSize: jest.fn().mockReturnValue(4000),
        getCompletions: jest.fn()
      }
    }),
    TOKEN_TO_CHAR_APPROXIMATION: 3.6
  }
})

jest.mock('../src/scripts/render', () => {
  return {
    RenderController: {
      getInstance: jest.fn().mockReturnValue({
        progressBars: {
          processingProgressBar: {
            set: jest.fn()
          }
        },
        showRequestProcessingProgressBar: jest.fn(),
        transition: jest.fn()
      })
    },
    AppStates: {
      analysis: 'analysis'
    }
  }
})

jest.mock('../src/scripts/utils', () => {
  return {
    randomInt: jest.fn(),
    chunkString: jest.fn(),
    extractJsonFromString: jest.requireActual('../src/scripts/utils').extractJsonFromString
  }
})

jest.mock('../src/scripts/prompt', () => {
  return {
    craftInstructions: jest.fn().mockImplementation(({ text }) => `Crafted: ${text}`),
    IntensityLevels: {
      NONE: 'NONE',
      WEAK: 'WEAK',
      MODERATE: 'MODERATE',
      STRONG: 'STRONG',
      EXTREME: 'EXTREME'
    }
  }
})

describe('analysis module', () => {
  describe('generateReport', () => {
    it('returns default summary when no valid metrics are provided', async () => {
      const result = await generateReport([])

      expect(result.summary).toEqual({
        ideologicalStrength: 'NONE',
        emotionalManipulationStrength: 'NONE',
        logicalFallaciesCount: 0,
        ideologicalMarkersCount: 0,
        promotedValuesCount: 0,
        emotionalManipulationsCount: 0
      })
      expect(result.proofs).toEqual({
        logicalFallacies: [],
        ideologicalMarkers: [],
        promotedValues: [],
        emotionalManipulations: []
      })
    })

    it('computes summary for multiple valid metrics', async () => {
      const metrics: Partial<ModelResponse>[] = [
        {
          ideologicalStrength: 'MODERATE',
          emotionalManipulationStrength: 'WEAK',
          ideologicalMarkers: [
            { associatedIdeology: 'TestIdeology1', quote: 'lorem ipsum ti1', explanation: 'bla' }
          ],
          promotedValues: [
            {
              associatedIdeology: 'TestIdeology2',
              quote: 'lorem ipsum ti2',
              explanation: 'bla bla'
            }
          ],
          emotionalManipulations: [
            { targetEmotion: 'fear', quote: 'qwe asd', explanation: 'bla bla bla' }
          ],
          logicalFallacies: [
            { fallacyType: 'straw_man', quote: 'zxc 123', explanation: 'bla bla bla bla' }
          ]
        },
        {
          ideologicalStrength: 'STRONG',
          emotionalManipulationStrength: 'STRONG',
          ideologicalMarkers: [
            {
              associatedIdeology: 'TestIdeology2',
              quote: 'example quote1',
              explanation: 'example explanation1'
            }
          ],
          promotedValues: [
            {
              associatedIdeology: 'testValue2',
              quote: 'example quote2',
              explanation: 'example explanation2'
            }
          ],
          emotionalManipulations: [
            { targetEmotion: 'anger', quote: 'example quote3', explanation: 'example explanation3' }
          ],
          logicalFallacies: [
            {
              fallacyType: 'ad_hominem',
              quote: 'example quote4',
              explanation: 'example explanation4'
            }
          ]
        }
      ]

      const result = await generateReport(metrics)
      expect(result.summary.ideologicalMarkersCount).toBe(2)
      expect(result.summary.promotedValuesCount).toBe(2)
      expect(result.summary.emotionalManipulationsCount).toBe(2)
      expect(result.summary.logicalFallaciesCount).toBe(2)
      expect(['MODERATE', 'STRONG', 'EXTREME'].includes(result.summary.ideologicalStrength)).toBe(
        true
      )
      expect(
        ['MODERATE', 'STRONG', 'EXTREME'].includes(result.summary.emotionalManipulationStrength)
      ).toBe(true)
      expect(result.proofs.ideologicalMarkers).toHaveLength(2)
      expect(result.proofs.promotedValues).toHaveLength(2)
      expect(result.proofs.emotionalManipulations).toHaveLength(2)
      expect(result.proofs.logicalFallacies).toHaveLength(2)
    })

    it('handles extreme values properly', async () => {
      const metrics: Partial<ModelResponse>[] = [
        {
          ideologicalMarkers: new Array(7).fill({ associatedIdeology: 'ExtremeIdeology' })
        }
      ]
      const result = await generateReport(metrics)

      expect(result.summary.ideologicalStrength).toBe('EXTREME')
    })
  })

  describe('getIntensityLevel', () => {
    it('returns NONE when value < WEAK threshold', () => {
      const level = getIntensityLevel(0, 0)

      expect(level).toBe('NONE')
    })

    it('returns WEAK when value is >=0.4 but <0.6', () => {
      const level = getIntensityLevel(0.4, 1)

      expect(level).toBe('WEAK')
    })

    it('returns MODERATE when value is >=0.6 but <0.8', () => {
      const level = getIntensityLevel(0.6, 1)

      expect(level).toBe('MODERATE')
    })

    it('returns STRONG when value is >=0.8 but <1 with enough signals', () => {
      const level = getIntensityLevel(0.8, 4)

      expect(level).toBe('STRONG')
    })

    it('returns EXTREME when value >=1 with enough signals', () => {
      const level = getIntensityLevel(1, 5)

      expect(level).toBe('EXTREME')
    })

    it('handles "edge case" of 0 but large signal count => EXTREME or STRONG', () => {
      const levelStrong = getIntensityLevel(0, 4)
      const levelExtreme = getIntensityLevel(0, 5)

      expect(levelExtreme).toBe('EXTREME')
      expect(levelStrong).toBe('STRONG')
    })
  })

  describe('extractMetricsFromContent', () => {
    let mockModel: ModelController
    let mockRenderer: ReturnType<typeof RenderController.getInstance>

    beforeEach(() => {
      jest.clearAllMocks()
      mockModel = new ModelController()
      mockRenderer = RenderController.getInstance()
    })

    it('returns an empty array if chunkString returns no chunks', async () => {
      ;(chunkString as jest.Mock).mockReturnValue([])
      const result = await extractMetricsFromContent('some content', mockModel)

      expect(result).toEqual([])
      expect(mockRenderer.transition).not.toHaveBeenCalled()
      expect(mockRenderer.showRequestProcessingProgressBar).not.toHaveBeenCalled()
    })

    it('handles a single chunk -> triggers dummy progress and processes chunk once', async () => {
      ;(chunkString as jest.Mock).mockReturnValue(['chunk1'])
      ;(mockModel.getCompletions as jest.Mock).mockResolvedValue({
        text: JSON.stringify({ ideologicalStrength: 'WEAK' }).padEnd(5000, ' ')
      })
      const result = await extractMetricsFromContent('some content', mockModel)

      expect(result).toEqual([{ ideologicalStrength: 'WEAK' }])
      expect(mockRenderer.transition).toHaveBeenCalledTimes(1)
      expect(mockRenderer.transition).toHaveBeenCalledWith(AppStates.analysis, {
        countOfChunks: 1,
        currentChunk: 1
      })
      expect(mockRenderer.showRequestProcessingProgressBar).toHaveBeenCalledTimes(2)
    })

    it('handles multiple chunks -> processes each chunk and no dummy progress', async () => {
      ;(chunkString as jest.Mock).mockReturnValue(['chunk1', 'chunk2', 'chunk3'])
      ;(mockModel.getCompletions as jest.Mock)
        .mockResolvedValueOnce({
          text: JSON.stringify({ ideologicalStrength: 'NONE' }).padEnd(5000, ' ')
        })
        .mockResolvedValueOnce({
          text: JSON.stringify({ ideologicalStrength: 'WEAK' }).padEnd(5000, ' ')
        })
        .mockResolvedValueOnce({
          text: JSON.stringify({ ideologicalStrength: 'STRONG' }).padEnd(5000, ' ')
        })
      const result = await extractMetricsFromContent('large content', mockModel)

      expect(result).toEqual([
        { ideologicalStrength: 'NONE' },
        { ideologicalStrength: 'WEAK' },
        { ideologicalStrength: 'STRONG' }
      ])
      expect(mockRenderer.transition).toHaveBeenCalledTimes(3)
      expect(mockRenderer.transition).toHaveBeenNthCalledWith(1, AppStates.analysis, {
        countOfChunks: 3,
        currentChunk: 1
      })
      expect(mockRenderer.transition).toHaveBeenNthCalledWith(2, AppStates.analysis, {
        countOfChunks: 3,
        currentChunk: 2
      })
      expect(mockRenderer.transition).toHaveBeenNthCalledWith(3, AppStates.analysis, {
        countOfChunks: 3,
        currentChunk: 3
      })
      expect(mockRenderer.showRequestProcessingProgressBar).toHaveBeenCalledTimes(4)
    })

    it('ignores null or small/invalid chunk responses (no progress update for them)', async () => {
      ;(chunkString as jest.Mock).mockReturnValue(['chunk1', 'chunk2', 'chunk3'])
      ;(mockModel.getCompletions as jest.Mock)
        .mockResolvedValueOnce({ text: 'tiny' })
        .mockResolvedValueOnce({ text: '{not real json' })
        .mockResolvedValueOnce({
          text: JSON.stringify({ ideologicalStrength: 'NONE' }).padEnd(5000, ' ')
        })
      const result = await extractMetricsFromContent('whatever', mockModel)

      expect(result).toEqual([{ ideologicalStrength: 'NONE' }])
      expect(mockRenderer.transition).toHaveBeenCalledTimes(3)
      expect(mockRenderer.showRequestProcessingProgressBar).toHaveBeenCalledTimes(2)
    })

    it('continues processing even if model.getCompletions rejects for some chunk', async () => {
      ;(chunkString as jest.Mock).mockReturnValue(['chunk1', 'chunk2', 'chunk3'])
      ;(mockModel.getCompletions as jest.Mock)
        .mockResolvedValueOnce({
          text: JSON.stringify({ ideologicalStrength: 'WEAK' }).padEnd(5000, ' ')
        })
        .mockRejectedValueOnce(new Error('Some fetch error'))
        .mockResolvedValueOnce({
          text: JSON.stringify({ ideologicalStrength: 'MODERATE' }).padEnd(5000, ' ')
        })

      const result = await extractMetricsFromContent('content', mockModel)
      // Provided your code has a try/catch around the chunk loop, it should keep going
      expect(result).toEqual([{ ideologicalStrength: 'WEAK' }, { ideologicalStrength: 'MODERATE' }])
      // transitions => 3 times, one per chunk
      expect(mockRenderer.transition).toHaveBeenCalledTimes(3)
      // progressBar.set => 1 (initialize) + 2 (for the two successful chunks) = 3
      expect(mockRenderer.showRequestProcessingProgressBar).toHaveBeenCalledTimes(3)
    })
  })

  describe('initializeProgress', () => {
    it('sets the initial progress bar value', () => {
      const renderer = RenderController.getInstance()
      const progressState = initializeProgress(3, renderer)

      expect(renderer.showRequestProcessingProgressBar).toHaveBeenCalledWith(
        ANALYSIS_CONFIG.PROGRESS.INITIAL
      )
      expect(progressState.value).toBe(ANALYSIS_CONFIG.PROGRESS.INITIAL)
      expect(progressState.step).toBeCloseTo(0.2, 5)
    })
  })

  describe('startDummyProgress', () => {
    it('returns a new state with intervalId set', () => {
      const renderer = RenderController.getInstance()
      jest.useFakeTimers()
      const initialState = {
        value: 0.3,
        step: 0.1
      }
      const newState = startDummyProgress(initialState, renderer)

      expect(newState.intervalId).toBeDefined()
      if (newState.intervalId) {
        clearInterval(newState.intervalId)
      }
      jest.useRealTimers()
    })
  })

  describe('updateProgress', () => {
    it('increases the current state progress by step', () => {
      const renderer = RenderController.getInstance()
      const initialState = {
        value: 0.3,
        step: 0.1
      }
      const updatedState = updateProgress(initialState, renderer)

      expect(updatedState.value).toBe(0.4)
      expect(renderer.showRequestProcessingProgressBar).toHaveBeenCalledWith(0.4)
    })
  })

  describe('processChunk', () => {
    let mockModel: ModelController

    beforeEach(() => {
      mockModel = new ModelController()
      ;(mockModel.getCompletions as jest.Mock).mockClear()
    })

    it('returns null if model response is missing text', async () => {
      ;(mockModel.getCompletions as jest.Mock).mockResolvedValueOnce(null)
      const result = await processChunk('some chunk', mockModel)

      expect(result).toBeNull()
    })

    it('returns null if response text is too short in tokens', async () => {
      ;(mockModel.getCompletions as jest.Mock).mockResolvedValueOnce({ text: 'tiny' })
      const result = await processChunk('some chunk', mockModel)

      expect(result).toBeNull()
    })

    it('parses JSON and returns ModelResponse if valid and large enough', async () => {
      const validObject = { ideologicalStrength: 'MODERATE' }
      const largeText = JSON.stringify(validObject).padEnd(4100, ' ')
      ;(mockModel.getCompletions as jest.Mock).mockResolvedValueOnce({ text: largeText })
      const result = await processChunk('some chunk', mockModel)

      expect(result).toEqual(validObject)
    })

    it('returns null if JSON parsing fails', async () => {
      const invalidJson = '{bad_json}'
      const largeText = invalidJson.padEnd(4100, ' ')
      ;(mockModel.getCompletions as jest.Mock).mockResolvedValueOnce({ text: largeText })
      const result = await processChunk('some chunk', mockModel)

      expect(result).toBeNull()
    })
  })
})
