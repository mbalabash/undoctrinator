import { removeExtraWhitespaces, TabConnection } from './utils'
import { AppStates, RenderController } from './render'
import { Readability } from '@mozilla/readability'
import { createWorker } from 'tesseract.js'

export type analyzeContentFn = (content: string) => Promise<void>

export class UserInputController {
  private ocrWorker: Tesseract.Worker | undefined
  private contentScriptConnection: TabConnection | undefined
  private renderer: RenderController | undefined
  private domParser: DOMParser = new DOMParser()

  async initTools(tabId: number) {
    this.ocrWorker = await createWorker('eng', 1, {
      corePath: '/dist/tesseract-core-simd-lstm.wasm.js',
      workerPath: '/dist/tesseract-worker.min.js',
      workerBlobURL: false,
      logger: (m: any) => console.log(m)
    })
    this.contentScriptConnection = new TabConnection(tabId)
    this.renderer = RenderController.getInstance()
  }

  handleImageInput = async (event: Event, onDataReady: analyzeContentFn) => {
    const input = event.target as HTMLInputElement
    const files = input.files
    if (!files || !this.ocrWorker) {
      return
    }

    try {
      await this.renderer?.transition(AppStates.data)

      const response = await this.ocrWorker.recognize(files[0])
      const content = removeExtraWhitespaces(response.data.text || '')
      input.value = '' // Clear the input value to allow re-uploading the same file

      await onDataReady(content)
    } catch (error) {
      console.error('Error occurred while analyzing the image:', error)
      throw error
    }
  }

  setupEventListenerForTextSelection = (onDataReady: analyzeContentFn) => {
    const processSelection = async (selection: Record<string, unknown>) => {
      if (selection && selection.text && typeof selection.text === 'string') {
        await this.renderer?.transition(AppStates.data)

        await onDataReady(removeExtraWhitespaces(selection.text))
      }
    }

    chrome.runtime.onMessage.addListener(message => {
      if (message.type === 'pendingSelectionReady') {
        chrome.runtime.sendMessage({ type: 'getPendingSelection' }, processSelection)
      }
    })
  }

  handlePageContentInput = async (onDataReady: analyzeContentFn) => {
    try {
      await this.renderer?.transition(AppStates.data)

      const documentClone = await this.getPageContent()
      const article = new Readability(documentClone).parse()
      const mainContent = removeExtraWhitespaces(
        `${article?.title || ''}\n${article?.textContent || ''}`
      )

      await onDataReady(mainContent)
    } catch (error) {
      console.error('Error occurred while analyzing the page:', error)
      throw error
    }
  }

  private async getPageContent(timeout: number = 5000): Promise<Document> {
    if (!this.contentScriptConnection) {
      throw new Error('Connection to content script not established')
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(
        () => reject(new Error('Request timeout: Unable to retrieve page content')),
        timeout
      )

      const handleResponse = (response: { type: string; contents: unknown }) => {
        clearTimeout(timeoutId)

        const doc = this.domParser.parseFromString(response.contents as string, 'text/html')
        this.contentScriptConnection!.removeMessageHandler('pageContent', handleResponse)

        resolve(doc)
      }

      this.contentScriptConnection!.addMessageHandler('pageContent', handleResponse)
      this.contentScriptConnection!.sendMessage({ type: 'getPageContent' })
    })
  }
}
