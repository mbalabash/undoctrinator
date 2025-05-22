import { ExtensionConfig } from './settings'

export async function ensureContentScriptInjected(
  tabId: number,
  throwOnFail: boolean = false
): Promise<void> {
  try {
    const [response] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.hasOwnProperty('undoctrinatorContentScriptInjected')
    })

    if (!response.result) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['dist/content.js']
      })

      await ensureContentScriptInjected(tabId, true)
    }
  } catch (error) {
    if (throwOnFail) throw error
    console.error('Script injection failed:', error)
  }
}

export async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

  if (!tab) throw new Error('No active tab found')

  return tab
}

export function getExtensionConfigFromStorage(): Promise<ExtensionConfig> {
  return new Promise(resolve => {
    chrome.storage.sync.get(['modelToUse', 'openAiApiKey', 'anthropicApiKey'], result => {
      if (!result.modelToUse) {
        result.modelToUse = 'WEBLLM_QWEN' // Default model
      }

      resolve({
        modelToUse: result.modelToUse || '',
        openAiApiKey: result.openAiApiKey || '',
        anthropicApiKey: result.anthropicApiKey || ''
      })
    })
  })
}

export function removeExtraWhitespaces(text: string) {
  return text.trim().replace(/\s+/g, ' ')
}

export function chunkString(text: string, chunkSize: number): string[] {
  if (chunkSize <= 0) {
    throw new Error('Chunk size must be greater than 0')
  }

  const chunks: string[] = []
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize))
  }

  return chunks
}

export function formatBytes(value: number): string {
  const units = ['bytes', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB']

  let l = 0
  let n = value || 0

  while (n >= 1024 && ++l) {
    n = n / 1024
  }

  return n.toFixed(n < 10 && l > 0 ? 1 : 0) + ' ' + units[l]
}

export function throttle(fn: (...args: unknown[]) => void, delay: number) {
  let isThrottled = false
  let lastArgs: unknown[]

  return (...args: unknown[]) => {
    if (isThrottled) {
      lastArgs = args
      return
    }

    fn(...args)
    isThrottled = true

    setTimeout(() => {
      isThrottled = false

      if (lastArgs) {
        fn(lastArgs)
        lastArgs = []
      }
    }, delay)
  }
}

export class TabConnection {
  private port: chrome.runtime.Port | null = null
  private reconnectionAttemptsMade: number = 0
  private messageHandlers: Map<
    string,
    ((response: { type: string; contents: unknown }) => void)[]
  > = new Map()
  private readonly tabId: number

  constructor(tabId: number, portName = 'undoctrinator-port') {
    this.tabId = tabId
    this.connect(portName)
  }

  private connect(portName = 'undoctrinator-port') {
    try {
      this.port = chrome.tabs.connect(this.tabId, { name: portName })
      this.setupListeners(portName)
    } catch (error) {
      console.error('Error occurred while connecting to the content script:', error)
    }
  }

  private setupListeners(portName = 'undoctrinator-port') {
    if (!this.port) return

    this.port.onDisconnect.addListener(() => {
      if (chrome.runtime.lastError) {
        console.error(
          'Error occurred that caused the content script to be disconnected:',
          chrome.runtime.lastError
        )
        this.reconnect(portName)
      }
    })

    this.port.onMessage.addListener((response: { type: string; contents: unknown }) => {
      const handlers = this.messageHandlers.get(response.type)

      if (Array.isArray(handlers)) {
        handlers.forEach(handler => handler(response))
      }
    })
  }

  private reconnect(portName = 'undoctrinator-port') {
    this.reconnectionAttemptsMade += 1

    if (this.reconnectionAttemptsMade > 3) {
      throw new Error('Exceeded maximum reconnection attempts')
    } else {
      this.port = null
      this.connect(portName)
    }
  }

  public addMessageHandler(
    type: string,
    handler: (response: { type: string; contents: unknown }) => void
  ) {
    const handlers = this.messageHandlers.get(type) || []
    handlers.push(handler)
    this.messageHandlers.set(type, handlers)
  }

  public removeMessageHandler(
    type: string,
    handler: (response: { type: string; contents: unknown }) => void
  ) {
    const handlers = this.messageHandlers.get(type)

    if (handlers) {
      const index = handlers.indexOf(handler)

      if (index > -1) {
        handlers.splice(index, 1)
      }
    }
  }

  public sendMessage(message: { type: string }) {
    if (!this.port) {
      this.connect()
    }

    this.port!.postMessage(message)
  }
}

export function extractJsonFromString<T>(text: string): null | T {
  if (!text || typeof text !== 'string') return null

  try {
    const jsonRegex = /\{(?:[^{}]|(?:\{(?:[^{}]|(?:\{[^{}]*\}))*\}))*\}/g
    const matches = text.match(jsonRegex)

    if (matches) {
      for (const match of matches) {
        try {
          return JSON.parse(match)
        } catch {
          continue
        }
      }
    }

    return null
  } catch {
    return null
  }
}

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}