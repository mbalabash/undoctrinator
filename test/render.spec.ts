import { JSDOM } from 'jsdom'
import DOMPurify from 'dompurify'
import { Line } from 'progressbar.js'
import { ReportData } from '../src/scripts/report'
import { RenderController, AppStates } from '../src/scripts/render'

jest.mock('progressbar.js', () => {
  return {
    Line: jest.fn().mockImplementation(() => ({
      set: jest.fn()
    })),
    Shape: jest.fn().mockImplementation(() => ({
      set: jest.fn()
    }))
  }
})

jest.mock('dompurify', () => ({
  sanitize: jest.fn((val: string) => val)
}))

jest.mock('../src/scripts/utils', () => ({
  throttle: jest.fn((fn: Function) => fn)
}))

function setupMockDOM() {
  const dom = new JSDOM(`
    <div id="main-view"></div>
    <div id="processing-view" class="visually-hidden">
      <div class="processing-view__cancel"></div>
      <div class="processing-view__item">
        <img class="processing-view__item-icon visually-hidden" />
        <img class="processing-view__item-icon visually-hidden" />
        <img class="processing-view__item-icon visually-hidden" />
      </div>
      <div class="processing-view__item">
        <img class="processing-view__item-icon visually-hidden" />
        <img class="processing-view__item-icon visually-hidden" />
        <img class="processing-view__item-icon visually-hidden" />
      </div>
      <div class="processing-view__item">
        <img class="processing-view__item-icon visually-hidden" />
        <img class="processing-view__item-icon visually-hidden" />
        <img class="processing-view__item-icon visually-hidden" />
      </div>
    </div>
    <div id="report-view" class="visually-hidden">
      <button class="report-view__close"></button>
      <div class="report-view__summary-item">
        <span>0</span>
      </div>
      <div class="report-view__summary-item">
        <span>0</span>
      </div>
      <div class="report-view__details-item">
        <button></button>
        <span></span>
        <div class="report-view__proofs visually-hidden"></div>
      </div>
      <div class="report-view__details-item">
        <button></button>
        <span></span>
        <div class="report-view__proofs visually-hidden"></div>
      </div>
      <div class="report-view__details-item">
        <button></button>
        <span></span>
        <div class="report-view__proofs visually-hidden"></div>
      </div>
    </div>
    <div id="error-view" class="visually-hidden">
      <h2 class="error-view__subtitle"></h2>
      <p class="error-view__description"></p>
    </div>
    <input id="image-file-input" />
    <button id="image-input-source-button"></button>
    <button id="page-input-source-button"></button>
    <label class="main-view__model-loaded visually-hidden"></label>
    <label class="main-view__model-loading visually-hidden"></label>
    <div id="model-loading-component" class="visually-hidden"></div>
    <div id="processing-timer">00:00</div>
    <div id="processing-chunks-counter"></div>
  `)

  global.window = dom.window as unknown as Window & typeof globalThis
  global.document = dom.window.document
  global.navigator = dom.window.navigator
}

describe('RenderController', () => {
  let controller: RenderController

  beforeEach(() => {
    setupMockDOM()
    jest.clearAllMocks()
    jest.useRealTimers()

    controller = RenderController.getInstance()
  })

  afterEach(() => {
    ;(RenderController as any).instance = null
  })

  it('should create a singleton instance', () => {
    const c2 = RenderController.getInstance()

    expect(c2).toBe(controller)
  })

  it('should initialize DOM elements and progress bars on construction', () => {
    // We expect the progress bars to have been constructed
    expect(Line).toHaveBeenCalledTimes(2)
    expect(controller.progressBars.modelProgressBar).toBeDefined()
    expect(controller.progressBars.processingProgressBar).toBeDefined()
    // Check a couple of the elements
    expect(controller['elements']['imageAnalysisButton']).toBeInstanceOf(global.window.HTMLElement)
    expect(controller['elements']['reportView']).toBeInstanceOf(global.window.HTMLElement)
  })

  describe('setupEventListeners', () => {
    it('should attach throttled event listeners correctly', () => {
      const onPageInputMock = jest.fn()
      const onImgInputMock = jest.fn()
      const onCancelMock = jest.fn()
      const registerSelectionInputHandlerMock = jest.fn()
      controller.setupEventListeners({
        onPageInput: onPageInputMock,
        onImgInput: onImgInputMock,
        onCancel: onCancelMock,
        registerSelectionInputHandler: registerSelectionInputHandlerMock
      })
      controller['elements']['pageAnalysisButton'].click()
      controller['elements']['imageAnalysisButton'].click()
      controller['elements']['reportViewCloseButton'].click()
      controller['elements']['processingCancelButton'].click()
      controller['elements']['imageAnalysisInput'].dispatchEvent(new global.window.Event('change'))

      expect(onPageInputMock).toHaveBeenCalledTimes(1)
      expect(onImgInputMock).toHaveBeenCalledTimes(1)
      expect(onCancelMock).toHaveBeenCalledTimes(1)
      expect(controller.currentState).toBe(AppStates.idle)
    })
  })

  describe('transition', () => {
    it('should move from idle -> modelInit -> modelReady successfully', async () => {
      expect(controller.currentState).toBe(AppStates.idle)

      await controller.transition(AppStates.modelInit)
      expect(controller.currentState).toBe(AppStates.modelInit)

      await controller.transition(AppStates.modelReady)
      expect(controller.currentState).toBe(AppStates.modelReady)

      expect(
        controller['elements']['modelLoadingLabel'].classList.contains('visually-hidden')
      ).toBe(true)
      expect(controller['elements']['modelLoadedLabel'].classList.contains('visually-hidden')).toBe(
        false
      )
    })

    it('should throw an error on invalid transitions', async () => {
      await expect(controller.transition(AppStates.analysis)).rejects.toThrow(
        'Invalid state transition'
      )
      await expect(controller.transition(AppStates.result)).rejects.toThrow(
        'Invalid state transition'
      )
    })

    it('should require analysis params when transitioning to analysis', async () => {
      await controller.transition(AppStates.data)
      await expect(controller.transition(AppStates.analysis)).rejects.toThrow(
        'Analysis state requires initial or countOfChunks'
      )

      await controller.transition(AppStates.analysis, { initial: true })
      expect(controller.currentState).toBe(AppStates.analysis)

      await controller.transition(AppStates.idle)
      expect(controller.currentState).toBe(AppStates.idle)
    })

    it('should require data param when transitioning to result', async () => {
      await controller.transition(AppStates.data)
      await controller.transition(AppStates.analysis, { initial: true })
      await controller.transition(AppStates.report)

      await expect(controller.transition(AppStates.result)).rejects.toThrow(
        'Result state requires data parameter'
      )

      const mockReport: ReportData = {
        summary: {
          ideologicalStrength: 'STRONG',
          emotionalManipulationStrength: 'MODERATE',
          ideologicalMarkersCount: 1,
          logicalFallaciesCount: 2,
          promotedValuesCount: 3,
          emotionalManipulationsCount: 1
        },
        proofs: {
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
        }
      }
      await controller.transition(AppStates.result, { data: mockReport })

      expect(controller.currentState).toBe(AppStates.result)
    })

    it('should require name and message params for error state', async () => {
      await expect(controller.transition(AppStates.error)).rejects.toThrow(
        'Error state requires name and message'
      )

      await controller.transition(AppStates.error, { name: 'SomeError', message: 'Oops!' })
      expect(controller.currentState).toBe(AppStates.error)
    })
  })

  describe('rendering behaviors', () => {
    it('should render idle state correctly', async () => {
      await controller.transition(AppStates.data)

      expect(controller.currentState).toBe(AppStates.data)

      await controller.transition(AppStates.analysis, { initial: true })
      await controller.transition(AppStates.idle)

      expect(controller.currentState).toBe(AppStates.idle)
      expect(controller['elements']['mainView'].classList.contains('visually-hidden')).toBe(false)
      expect(controller['elements']['reportView'].classList.contains('visually-hidden')).toBe(true)
    })

    it('should correctly handle processing time counter increments', () => {
      controller['elements']['processingTimer'].innerText = '00:59'
      ;(controller as any).renderProcessingTimeCounter()

      expect(controller['elements']['processingTimer'].innerText).toBe('01:00')
    })

    it('should set progress bar to 1 and reveal final icons in renderReportGenerationState', async () => {
      await controller.transition(AppStates.data)
      await controller.transition(AppStates.analysis, { initial: true })
      await controller.transition(AppStates.report)

      // Because we mock the progress bar, we can test that 'set' was called with 1
      const mockProgressBar = controller.progressBars['processingProgressBar']
      expect(mockProgressBar.set).toHaveBeenCalledWith(1)

      await controller.transition(AppStates.error, { name: 'SomeError', message: 'Oops!' })
      expect(mockProgressBar.set).toHaveBeenCalledWith(0)
    })

    it('should sanitize text with DOMPurify', async () => {
      const mockReport: ReportData = {
        summary: {
          ideologicalStrength: 'STRONG',
          emotionalManipulationStrength: 'MODERATE',
          ideologicalMarkersCount: 1,
          logicalFallaciesCount: 2,
          promotedValuesCount: 3,
          emotionalManipulationsCount: 1
        },
        proofs: {
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
        }
      }

      await controller.transition(AppStates.data)
      await controller.transition(AppStates.analysis, { initial: true })
      await controller.transition(AppStates.report)
      await controller.transition(AppStates.result, { data: mockReport })

      expect(DOMPurify.sanitize).toHaveBeenCalled()
    })
  })
})
