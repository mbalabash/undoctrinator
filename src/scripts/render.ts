import { proofsValueKeys } from './prompt'
import Shape from 'progressbar.js/shape'
import { ReportData } from './report'
import { Line } from 'progressbar.js'
import { throttle } from './utils'
import DOMPurify from 'dompurify'

export enum AppStates {
  idle = 'idle',
  modelInit = 'model-init',
  modelReady = 'model-ready',
  data = 'data',
  analysis = 'analysis',
  report = 'report',
  result = 'result',
  error = 'error'
}
const AllowedTransitions: Record<AppStates, AppStates[]> = {
  [AppStates.idle]: [
    AppStates.modelInit,
    AppStates.modelReady,
    AppStates.data,
    AppStates.error,
    AppStates.idle
  ],
  [AppStates.modelInit]: [AppStates.modelReady, AppStates.error],
  [AppStates.modelReady]: [AppStates.idle, AppStates.error],
  [AppStates.data]: [AppStates.analysis, AppStates.error],
  [AppStates.analysis]: [AppStates.analysis, AppStates.report, AppStates.error, AppStates.idle],
  [AppStates.report]: [AppStates.result, AppStates.error],
  [AppStates.result]: [AppStates.idle, AppStates.data, AppStates.error],
  [AppStates.error]: [AppStates.idle, AppStates.data]
} as const

type StateTransitionHandler = (params?: Record<string, unknown>) => Promise<void> | void

export class RenderController {
  static instance: RenderController | null = null

  private elements: Record<string, HTMLElement> = {}
  private processingIntervalId: ReturnType<typeof setInterval> = -1 as unknown as ReturnType<
    typeof setInterval
  >

  public history: AppStates[] = []
  public progressBars: Record<string, Shape> = {}
  public currentState: AppStates = AppStates.idle

  constructor() {
    this.elements['imageAnalysisButton'] = document.getElementById('image-input-source-button')!
    this.elements['pageAnalysisButton'] = document.getElementById('page-input-source-button')!
    this.elements['imageAnalysisInput'] = document.getElementById('image-file-input')!
    this.elements['processingCancelButton'] = document.querySelector('.processing-view__cancel')!
    this.elements['reportViewCloseButton'] = document.querySelector('.report-view__close')!
    this.elements['modelLoadedLabel'] = document.querySelector('.main-view__model-loaded')!
    this.elements['modelLoadingLabel'] = document.querySelector('.main-view__model-loading')!
    this.elements['progressBarContainer'] = document.getElementById('model-loading-component')!
    this.elements['processingTimer'] = document.getElementById('processing-timer')!
    this.elements['processingChunksCounter'] = document.getElementById('processing-chunks-counter')!

    this.elements['mainView'] = document.getElementById('main-view')!
    this.elements['processingView'] = document.getElementById('processing-view')!
    this.elements['reportView'] = document.getElementById('report-view')!
    this.elements['errorView'] = document.getElementById('error-view')!

    this.progressBars['modelProgressBar'] = new Line('#model-loading-component', {
      strokeWidth: 4,
      color: '#503e39',
      trailColor: '#f8f8f8',
      trailWidth: 4,
      easing: 'easeInOut',
      duration: 1400,
      svgStyle: { width: '100%', height: '100%' }
    })
    this.progressBars['processingProgressBar'] = new Line('#processing-progress-component', {
      strokeWidth: 6,
      color: '#503e39',
      trailColor: '#f8f8f8',
      trailWidth: 6,
      easing: 'easeInOut',
      duration: 1400,
      svgStyle: { width: '100%', height: '100%' }
    })
  }

  static getInstance() {
    if (!this.instance) {
      this.instance = new RenderController()
    }

    return this.instance
  }

  setupEventListeners = (handlers: {
    onPageInput: () => void
    onImgInput: (event: Event) => void
    onCancel: () => void
    registerSelectionInputHandler: () => void
  }) => {
    this.elements['pageAnalysisButton'].addEventListener(
      'click',
      throttle(() => handlers.onPageInput(), 1256)
    )
    this.elements['imageAnalysisButton'].addEventListener(
      'click',
      throttle(() => this.elements['imageAnalysisInput'].click(), 1256)
    )
    this.elements['imageAnalysisInput'].addEventListener('change', event =>
      handlers.onImgInput(event)
    )
    this.elements['reportViewCloseButton'].addEventListener('click', () =>
      this.transition(AppStates.idle)
    )
    this.elements['processingCancelButton'].addEventListener('click', () => {
      handlers.onCancel()
      this.transition(AppStates.idle)
    })
    ;(this.elements['reportView'].querySelectorAll('.report-view__details-item') || []).forEach(
      item => {
        const button = item.querySelector('button')!
        button.addEventListener('click', () => {
          const expanded = button.getAttribute('aria-expanded') === 'true'
          button.setAttribute('aria-expanded', (!expanded).toString())
          item.classList.toggle('report-view__details-item--expanded')
        })
      }
    )
    handlers.registerSelectionInputHandler()
  }

  transition = async (nextState: AppStates, params?: Record<string, unknown>) => {
    if (!AllowedTransitions[this.currentState].includes(nextState)) {
      throw new Error(`Invalid state transition from ${this.currentState} to ${nextState}`)
    }

    const handler = this.getTransitionHandler(nextState, params)
    await handler()

    this.history.push(this.currentState)
    this.currentState = nextState
  }

  showModelInitializationProgressBar = (progress: number) => {
    this.progressBars['modelProgressBar'].animate(progress)
  }

  showRequestProcessingProgressBar = (progress: number) => {
    this.progressBars['processingProgressBar'].animate(progress)
  }

  private getTransitionHandler = (
    nextState: AppStates,
    params?: Record<string, unknown>
  ): StateTransitionHandler => {
    let handlerFn

    switch (nextState) {
      case AppStates.idle: {
        handlerFn = this.renderIdleState
        break
      }
      case AppStates.modelInit: {
        handlerFn = this.renderModelInitState
        break
      }
      case AppStates.modelReady: {
        handlerFn = this.renderModelReadyState
        break
      }
      case AppStates.data: {
        handlerFn = this.renderDataExtractionState
        break
      }
      case AppStates.analysis: {
        handlerFn = () => {
          if (params && (params.initial || (params.countOfChunks && params.currentChunk))) {
            this.renderAnalysisProgressState(params)
          } else {
            throw new Error(
              'Analysis state requires initial or countOfChunks, and currentChunk parameters'
            )
          }
        }
        break
      }
      case AppStates.report: {
        handlerFn = this.renderReportGenerationState
        break
      }
      case AppStates.result: {
        handlerFn = () => {
          if (params && params.data) {
            this.renderResultState(params.data as ReportData)
          } else {
            throw new Error('Result state requires data parameter')
          }
        }
        break
      }
      case AppStates.error: {
        handlerFn = () => {
          if (params && typeof params.name === 'string' && typeof params.message === 'string') {
            this.renderErrorState({ name: params.name, message: params.message })
          } else {
            throw new Error('Error state requires name and message parameters')
          }
        }
        break
      }
      default:
        break
    }

    if (handlerFn) {
      return handlerFn
    } else {
      throw new Error(
        `No transition handler defined for state: ${nextState} with params: ${JSON.stringify(params, null, 2)}`
      )
    }
  }

  private resetTimers = () => {
    clearInterval(this.processingIntervalId)
    this.elements['processingTimer'].innerText = '00:00'
  }

  private resetReportView = () => {
    this.elements['reportView']
      .querySelectorAll('.report-view__proofs')
      .forEach(item => (item.innerHTML = ''))

    this.elements['reportView'].querySelectorAll('.report-view__details-item').forEach(item => {
      ;(item as HTMLDivElement).classList.remove('report-view__details-item--expanded')
      const button = item.querySelector('button')! as HTMLButtonElement
      button.disabled = false
      button.setAttribute('aria-expanded', 'false')
    })
  }

  private resetProcessingView = () => {
    this.resetTimers()

    this.elements['processingView'].querySelectorAll('.processing-view__item').forEach(item => {
      const icons = item.querySelectorAll('img')
      for (let i = 0; i < icons.length; i += 1) {
        icons[i].classList.add('visually-hidden')
      }
    })

    this.elements['processingTimer'].innerText = '00:00'
    this.elements['processingChunksCounter'].innerText = ''
    this.progressBars['processingProgressBar'].set(0)
  }

  private renderIdleState = () => {
    this.resetTimers()
    this.resetReportView()
    this.resetProcessingView()

    this.elements['mainView'].classList.remove('visually-hidden')
    this.elements['processingView'].classList.add('visually-hidden')
    this.elements['reportView'].classList.add('visually-hidden')
    this.elements['errorView'].classList.add('visually-hidden')
  }

  private renderModelInitState = () => {
    ;(this.elements['imageAnalysisButton'] as HTMLButtonElement).disabled = true
    ;(this.elements['pageAnalysisButton'] as HTMLButtonElement).disabled = true
    this.elements['modelLoadingLabel'].classList.remove('visually-hidden')
    this.elements['progressBarContainer'].classList.remove('visually-hidden')
  }

  private renderModelReadyState = () => {
    this.elements['progressBarContainer'].classList.add('visually-hidden')
    this.elements['modelLoadingLabel'].classList.add('visually-hidden')
    this.elements['modelLoadedLabel'].classList.remove('visually-hidden')
    ;(this.elements['imageAnalysisButton'] as HTMLButtonElement).disabled = false
    ;(this.elements['pageAnalysisButton'] as HTMLButtonElement).disabled = false
  }

  private renderProcessingTimeCounter = () => {
    const timerValue = this.elements['processingTimer'].innerText
    const time =
      typeof timerValue === 'string' && timerValue.includes(':')
        ? timerValue.split(':')
        : ['00', '00']
    let min = parseInt(time[0], 10)
    let sec = parseInt(time[1], 10)

    if (sec === 59) {
      min += 1
      sec = 0
    } else {
      sec += 1
    }

    const nextValue = `${min < 10 ? `0${min}` : min}:${sec < 10 ? `0${sec}` : sec}`
    this.elements['processingTimer'].innerText = nextValue
  }

  private renderDataExtractionState = () => {
    this.elements['mainView'].classList.add('visually-hidden')
    this.elements['processingView'].classList.remove('visually-hidden')
    this.elements['reportView'].classList.add('visually-hidden')
    this.elements['errorView'].classList.add('visually-hidden')

    this.processingIntervalId = setInterval(this.renderProcessingTimeCounter, 1000)
    this.progressBars['processingProgressBar'].set(0.1)

    const processingSteps =
      this.elements['processingView'].querySelectorAll('.processing-view__item')

    for (let i = 0; i < processingSteps.length; i += 1) {
      if (i === 0) {
        processingSteps[i]
          .querySelectorAll('.processing-view__item-icon')[0]
          .classList.add('visually-hidden')
        processingSteps[i]
          .querySelectorAll('.processing-view__item-icon')[1]
          .classList.remove('visually-hidden')
      } else {
        processingSteps[i]
          .querySelectorAll('.processing-view__item-icon')[0]
          .classList.remove('visually-hidden')
      }
    }
  }

  private renderAnalysisProgressState = (params: {
    initial?: boolean
    countOfChunks?: number
    currentChunk?: number
  }) => {
    if (typeof params.initial === 'boolean' && params.initial) {
      const [dataItem, metricsItem] =
        this.elements['processingView'].querySelectorAll('.processing-view__item')
      if (dataItem) {
        dataItem.querySelectorAll('.processing-view__item-icon')[1].classList.add('visually-hidden')
        dataItem
          .querySelectorAll('.processing-view__item-icon')[2]
          .classList.remove('visually-hidden')
      }
      if (metricsItem) {
        metricsItem
          .querySelectorAll('.processing-view__item-icon')[0]
          .classList.add('visually-hidden')
        metricsItem
          .querySelectorAll('.processing-view__item-icon')[1]
          .classList.remove('visually-hidden')
      }
    }

    if (typeof params.countOfChunks === 'number' && typeof params.currentChunk === 'number') {
      this.elements['processingChunksCounter'].innerText = DOMPurify.sanitize(
        `Chunk ${params.currentChunk} of ${params.countOfChunks}`
      )
    }
  }

  private renderReportGenerationState = () => {
    this.progressBars['processingProgressBar'].set(1)

    const [, metricsItem, reportItem] =
      this.elements['processingView'].querySelectorAll('.processing-view__item')
    if (metricsItem) {
      metricsItem
        .querySelectorAll('.processing-view__item-icon')[1]
        .classList.add('visually-hidden')
      metricsItem
        .querySelectorAll('.processing-view__item-icon')[2]
        .classList.remove('visually-hidden')
    }
    if (reportItem) {
      reportItem.querySelectorAll('.processing-view__item-icon')[0].classList.add('visually-hidden')
      reportItem
        .querySelectorAll('.processing-view__item-icon')[1]
        .classList.remove('visually-hidden')
    }
  }

  private renderSmoothTransitionToResultState = () => {
    this.elements['mainView'].classList.add('visually-hidden')
    this.elements['processingView'].classList.add('visually-hidden')
    this.elements['reportView'].classList.remove('visually-hidden')
    this.elements['errorView'].classList.add('visually-hidden')
  }

  private renderMetricProofs = (
    elem: Element,
    proofs: {
      quote: string
      explanation: string
      associatedIdeology?: string
      targetEmotion?: string
      fallacyType?: string
    }[]
  ) => {
    elem.innerHTML = DOMPurify.sanitize(
      proofs
        .map(item => {
          let key = item.associatedIdeology || item.targetEmotion || item.fallacyType || ''
          return `<p><strong>${key}</strong><em>"${item.quote || ''}"</em><br/>${item.explanation || ''}</p>`
        })
        .join('')
    )
  }

  private renderResultState = (report: ReportData) => {
    const [, , reportItem] =
      this.elements['processingView'].querySelectorAll('.processing-view__item')
    if (reportItem) {
      reportItem.querySelectorAll('.processing-view__item-icon')[1].classList.add('visually-hidden')
      reportItem
        .querySelectorAll('.processing-view__item-icon')[2]
        .classList.remove('visually-hidden')
    }

    const [ideologicalStrength, emotionalStrength] = this.elements['reportView'].querySelectorAll(
      '.report-view__summary-item span'
    )
    ideologicalStrength.innerHTML = DOMPurify.sanitize(report.summary.ideologicalStrength)
    emotionalStrength.innerHTML = DOMPurify.sanitize(report.summary.emotionalManipulationStrength)

    const detailsItems = this.elements['reportView'].querySelectorAll('.report-view__details-item')
    for (let i = 0; i < detailsItems.length; i += 1) {
      const counter = detailsItems[i].querySelector('span')!
      const proofList = detailsItems[i].querySelector('.report-view__proofs')!

      const count = report.summary[`${proofsValueKeys[i]}Count`].toString() || 'None'
      counter.innerText = DOMPurify.sanitize(count)

      const proofs = report.proofs[proofsValueKeys[i]] || []
      if (proofs.length) {
        detailsItems[i].classList.add('report-view__details-item--expandable')
        proofList.classList.remove('visually-hidden')
        this.renderMetricProofs(proofList, proofs)
      } else {
        detailsItems[i].classList.remove('report-view__details-item--expandable')
        detailsItems[i].querySelector('button')!.disabled = true
      }
    }

    // a short delay for the user to notice that the processing state has ended
    const timeoutId = setTimeout(() => {
      this.renderSmoothTransitionToResultState()
      this.resetProcessingView()
      clearTimeout(timeoutId)
    }, 300)
  }

  private renderErrorState = (error: { name: string; message: string }) => {
    this.resetTimers()
    this.resetReportView()
    this.resetProcessingView()

    this.elements['mainView'].classList.add('visually-hidden')
    this.elements['processingView'].classList.add('visually-hidden')
    this.elements['reportView'].classList.add('visually-hidden')
    this.elements['errorView'].classList.remove('visually-hidden')

    const nameElem = this.elements['errorView'].querySelector('.error-view__subtitle')
    if (nameElem) {
      nameElem.innerHTML = DOMPurify.sanitize(error.name)
    }

    const msgElem = this.elements['errorView'].querySelector('.error-view__description')
    if (msgElem) {
      msgElem.innerHTML = DOMPurify.sanitize(error.message)
    }
  }
}
