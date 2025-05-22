import { ModelController } from './model'
import { AppStates, RenderController } from './render'
import { analyzeContentFn, UserInputController } from './user-input'
import { extractMetricsFromContent, generateReport } from './report'
import { getActiveTab, ensureContentScriptInjected, getExtensionConfigFromStorage } from './utils'

const modelController = new ModelController()
const userInputController = new UserInputController()
const renderer = RenderController.getInstance()

async function initializePopup() {
  try {
    const tab = await getActiveTab()
    chrome.runtime.connect({ name: 'popup' })
    const config = await getExtensionConfigFromStorage()

    // initialize user input controller
    await Promise.all([
      ensureContentScriptInjected(tab.id!),
      userInputController.initTools(tab.id!)
    ])

    // bind input handlers
    renderer.setupEventListeners({
      onPageInput: () => userInputController.handlePageContentInput(analyzeContent),
      onImgInput: event => userInputController.handleImageInput(event, analyzeContent),
      registerSelectionInputHandler: () =>
        userInputController.setupEventListenerForTextSelection(analyzeContent),
      onCancel: () => modelController.stopGeneration()
    })

    // initialize model controller
    await renderer.transition(AppStates.modelInit)
    await modelController.initialize(config)
    await renderer.transition(AppStates.modelReady)

    await renderer.transition(AppStates.idle)
  } catch (error) {
    console.error('Error initializing the app:', error)

    const { name, message } = error as Error
    await renderer.transition(AppStates.error, { name, message })
  }
}

const analyzeContent: analyzeContentFn = async content => {
  try {
    if (!content.length) {
      throw new Error('Content and sourceType are required to perform the analysis')
    }

    const startTime = Date.now()
    await renderer.transition(AppStates.analysis, { initial: true })

    const metrics = await extractMetricsFromContent(content, modelController)
    if (metrics.length === 0 && renderer.currentState === AppStates.idle) {
      // user has canceled the operation
      return
    }

    await renderer.transition(AppStates.report)
    const report = await generateReport(metrics)

    await renderer.transition(AppStates.result, { data: report })
    console.info('Result:', report, 'done in:', (Date.now() - startTime) / 1000, 'seconds')
  } catch (error) {
    console.error('Error analyzing the content:', error)

    const { name, message } = error as Error
    await renderer.transition(AppStates.error, { name, message })
  }
}

window.onload = async () => {
  try {
    await initializePopup()
  } catch (error) {
    console.error('Error initializing app:', error)

    const { name, message } = error as Error
    await renderer.transition(AppStates.error, { name, message })
  }
}
