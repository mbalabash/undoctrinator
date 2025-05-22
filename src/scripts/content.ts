class ContentScriptController {
  private supportedRequestTypes = ['getPageContent']

  constructor() {
    this.initializePortListener()
  }

  private initializePortListener(): void {
    chrome.runtime.onConnect.addListener(port => {
      if (port.name === 'undoctrinator-port') {
        this.handlePortConnection(port)
      }
    })
  }

  private handlePortConnection(port: chrome.runtime.Port): void {
    port.onMessage.addListener(msg => this.handleMessage(port, msg))
  }

  private handleMessage(port: chrome.runtime.Port, message: { type: string }) {
    if (!message || !message.type) {
      console.error('Invalid message received: message or message type is missing')
      return
    }
    if (!this.supportedRequestTypes.includes(message.type)) {
      console.error('Unsupported message type:', message.type)
      return
    }

    switch (message.type) {
      case 'getPageContent':
        port.postMessage(this.getPageContent())
        break

      default:
        break
    }
  }

  private getPageContent(): { type: 'pageContent'; contents: string } {
    return {
      type: 'pageContent',
      contents: document.body.innerHTML
    }
  }
}

// @ts-expect-error
window.undoctrinatorContentScriptInjected = true
new ContentScriptController()
