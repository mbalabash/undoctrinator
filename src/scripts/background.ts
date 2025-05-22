import { ExtensionServiceWorkerMLCEngineHandler } from '@mlc-ai/web-llm'

// Track the state of the extension popup
let isPopupOpen: boolean = false
chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'popup') {
    isPopupOpen = true

    port.onDisconnect.addListener(() => {
      isPopupOpen = false
    })
  }
})

// Register a worker for web-llm
let webLLMWorker: ExtensionServiceWorkerMLCEngineHandler | undefined
chrome.runtime.onConnect.addListener(port => {
  if (webLLMWorker === undefined) {
    webLLMWorker = new ExtensionServiceWorkerMLCEngineHandler(port)
  } else {
    webLLMWorker.setPort(port)
  }

  port.onMessage.addListener(message => {
    // console.info('web-llm-worker:', message)

    webLLMWorker?.onmessage.bind(webLLMWorker)(message)
  })
})

// Create context menu item
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'undoctrinator.analyzeSelection',
    title: 'Undoctrinator: scan selected text',
    contexts: ['selection']
  })
})

// Handle user input via context menu
let pendingSelection: string | null = null
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return

  if (info.selectionText && info.menuItemId === 'undoctrinator.analyzeSelection') {
    // Store selected text
    pendingSelection = info.selectionText

    // Open popup if it's not already open
    if (!isPopupOpen) {
      await chrome.action.openPopup()
    }

    // Notify popup of pending selection
    setTimeout(async () => {
      await chrome.runtime.sendMessage({ type: 'pendingSelectionReady' })
    }, 256)
  }
})

// Send selected text to popup when requested
chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
  if (message.type === 'getPendingSelection') {
    const selection = { text: pendingSelection }
    sendResponse(selection)
    pendingSelection = null
  }
})
