import {
  ensureContentScriptInjected,
  getExtensionConfigFromStorage,
  removeExtraWhitespaces,
  chunkString,
  formatBytes,
  throttle,
  TabConnection,
  extractJsonFromString
} from '../src/scripts/utils'

describe('Utils', () => {
  beforeAll(() => {
    global.chrome = {
      scripting: {
        executeScript: jest.fn()
      },
      tabs: {
        query: jest.fn(),
        connect: jest.fn()
      },
      storage: {
        sync: {
          get: jest.fn()
        }
      },
      runtime: {
        lastError: undefined
      }
    } as unknown as jest.Mocked<typeof chrome>
  })

  describe('ensureContentScriptInjected', () => {
    const mockTabId = 123

    beforeEach(() => {
      jest.clearAllMocks()
    })

    it('should not inject script if it is already injected', async () => {
      ;(chrome.scripting.executeScript as jest.Mock).mockResolvedValueOnce([{ result: true }])

      await ensureContentScriptInjected(mockTabId)

      // Should check if script is injected
      expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1)
      expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
        target: { tabId: mockTabId },
        func: expect.any(Function)
      })
    })

    it('should inject script if it is not already injected', async () => {
      ;(chrome.scripting.executeScript as jest.Mock).mockResolvedValueOnce([{ result: false }])
      ;(chrome.scripting.executeScript as jest.Mock).mockResolvedValueOnce([])
      ;(chrome.scripting.executeScript as jest.Mock).mockResolvedValueOnce([{ result: true }])
      await ensureContentScriptInjected(mockTabId)

      expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(3)
      expect(chrome.scripting.executeScript).toHaveBeenNthCalledWith(1, {
        target: { tabId: mockTabId },
        func: expect.any(Function)
      })
      expect(chrome.scripting.executeScript).toHaveBeenNthCalledWith(2, {
        target: { tabId: mockTabId },
        files: ['dist/content.js']
      })
      expect(chrome.scripting.executeScript).toHaveBeenNthCalledWith(3, {
        target: { tabId: mockTabId },
        func: expect.any(Function)
      })
    })

    it('should handle injection failure gracefully when throwOnFail is false', async () => {
      const mockError = new Error('Tab does not exist')
      ;(chrome.scripting.executeScript as jest.Mock).mockRejectedValueOnce(mockError)
      console.error = jest.fn()
      await ensureContentScriptInjected(mockTabId)

      expect(console.error).toHaveBeenCalledWith('Script injection failed:', mockError)
    })

    it('should throw error on injection failure when throwOnFail is true', async () => {
      const mockError = new Error('Tab does not exist')
      ;(chrome.scripting.executeScript as jest.Mock).mockRejectedValueOnce(mockError)

      await expect(ensureContentScriptInjected(mockTabId, true)).rejects.toThrow(mockError)
    })

    it('should handle the case when script injection succeeds but recursive check still shows not injected', async () => {
      ;(chrome.scripting.executeScript as jest.Mock).mockResolvedValueOnce([{ result: false }])
      ;(chrome.scripting.executeScript as jest.Mock).mockResolvedValueOnce([])
      ;(chrome.scripting.executeScript as jest.Mock).mockResolvedValueOnce([{ result: false }])
      ;(chrome.scripting.executeScript as jest.Mock).mockResolvedValueOnce([])
      ;(chrome.scripting.executeScript as jest.Mock).mockResolvedValueOnce([{ result: true }])
      await ensureContentScriptInjected(mockTabId)

      expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(5)
    })

    it('should handle missing response data edge case', async () => {
      ;(chrome.scripting.executeScript as jest.Mock).mockResolvedValueOnce([])
      console.error = jest.fn()
      await ensureContentScriptInjected(mockTabId)

      expect(console.error).toHaveBeenCalled()
    })
  })

  describe('getExtensionConfigFromStorage', () => {
    it('should return the extension config from storage', async () => {
      const data = {
        qwe: 'asd',
        lorem: 'ipsum',
        modelToUse: 'model',
        openAiApiKey: 'key',
        anthropicApiKey: 'key'
      }
      const expectedConfig = { modelToUse: 'model', openAiApiKey: 'key', anthropicApiKey: 'key' }
      ;(chrome.storage.sync.get as jest.Mock).mockImplementation((keys, callback) => {
        callback(data)
      })
      const config = await getExtensionConfigFromStorage()

      expect(config).toEqual(expectedConfig)
    })
  })

  describe('removeExtraWhitespaces', () => {
    it('should remove extra whitespaces from a string', () => {
      const text = '  Hello   World  '
      const result = removeExtraWhitespaces(text)

      expect(result).toBe('Hello World')
    })
  })

  describe('chunkString', () => {
    it('should chunk a string into specified sizes', () => {
      const text = 'HelloWorld'
      const chunkSize = 5
      const result = chunkString(text, chunkSize)

      expect(result).toEqual(['Hello', 'World'])
    })

    it('should throw an error if chunk size is less than or equal to 0', () => {
      expect(() => chunkString('HelloWorld', 0)).toThrow('Chunk size must be greater than 0')
    })
  })

  describe('formatBytes', () => {
    it('should format bytes correctly', () => {
      expect(formatBytes(1024)).toBe('1.0 KiB')
      expect(formatBytes(1048576)).toBe('1.0 MiB')
      expect(formatBytes(123456789)).toBe('118 MiB')
    })
  })

  describe('throttle', () => {
    jest.useFakeTimers()

    it('should throttle function calls', () => {
      const fn = jest.fn()
      const throttledFn = throttle(fn, 1000)

      throttledFn()
      jest.advanceTimersByTime(1000)
      throttledFn()
      throttledFn()

      expect(fn).toHaveBeenCalledTimes(2)
    })
  })

  describe('TabConnection', () => {
    const mockTabId = 123
    const defaultPortName = 'undoctrinator-port'
    let mockPort: {
      onDisconnect: { addListener: jest.Mock }
      onMessage: { addListener: jest.Mock }
      postMessage: jest.Mock
    }

    beforeEach(() => {
      jest.clearAllMocks()

      mockPort = {
        onDisconnect: { addListener: jest.fn() },
        onMessage: { addListener: jest.fn() },
        postMessage: jest.fn()
      }
      ;(chrome.tabs.connect as jest.Mock).mockReturnValue(mockPort)

      // Reset chrome.runtime.lastError
      chrome.runtime.lastError = undefined
    })

    describe('constructor and connect', () => {
      it('should connect to the tab and set up listeners on initialization', () => {
        new TabConnection(mockTabId)

        expect(chrome.tabs.connect).toHaveBeenCalledWith(mockTabId, { name: defaultPortName })
        expect(mockPort.onDisconnect.addListener).toHaveBeenCalled()
        expect(mockPort.onMessage.addListener).toHaveBeenCalled()
      })

      it('should use custom port name when provided', () => {
        const customPortName = 'custom-port'
        new TabConnection(mockTabId, customPortName)

        expect(chrome.tabs.connect).toHaveBeenCalledWith(mockTabId, { name: customPortName })
      })

      it('should handle connection errors gracefully', () => {
        console.error = jest.fn()
        const mockError = new Error('Connection failed')
        ;(chrome.tabs.connect as jest.Mock).mockImplementationOnce(() => {
          throw mockError
        })
        new TabConnection(mockTabId)

        expect(console.error).toHaveBeenCalledWith(
          'Error occurred while connecting to the content script:',
          mockError
        )
      })
    })

    describe('setupListeners', () => {
      it('should not set up listeners if port is null', () => {
        ;(chrome.tabs.connect as jest.Mock).mockImplementationOnce(() => {
          throw new Error('Connection failed')
        })
        new TabConnection(mockTabId)

        expect(mockPort.onDisconnect.addListener).not.toHaveBeenCalled()
        expect(mockPort.onMessage.addListener).not.toHaveBeenCalled()
      })

      it('should handle disconnect events and try to reconnect', () => {
        const connection = new TabConnection(mockTabId)
        const disconnectCallback = mockPort.onDisconnect.addListener.mock.calls[0][0]
        chrome.runtime.lastError = { message: 'Tab was closed' }
        const reconnectSpy = jest.spyOn(connection as any, 'reconnect')
        disconnectCallback()

        expect(console.error).toHaveBeenCalledWith(
          'Error occurred that caused the content script to be disconnected:',
          chrome.runtime.lastError
        )
        expect(reconnectSpy).toHaveBeenCalledWith(defaultPortName)
      })

      it('should route messages to the correct handlers', () => {
        const connection = new TabConnection(mockTabId)
        const testHandler = jest.fn()
        connection.addMessageHandler('test-type', testHandler)
        const messageCallback = mockPort.onMessage.addListener.mock.calls[0][0]
        const testMessage = { type: 'test-type', contents: { data: 'test-data' } }
        messageCallback(testMessage)

        expect(testHandler).toHaveBeenCalledWith(testMessage)
      })

      it('should handle messages with no registered handlers', () => {
        new TabConnection(mockTabId)
        const messageCallback = mockPort.onMessage.addListener.mock.calls[0][0]
        const testMessage = { type: 'unknown-type', contents: { data: 'test-data' } }

        expect(() => {
          messageCallback(testMessage)
        }).not.toThrow()
      })
    })

    describe('reconnect', () => {
      it('should attempt to reconnect up to 3 times', () => {
        const connection = new TabConnection(mockTabId)
        ;(connection as any).reconnectionAttemptsMade = 0
        const connectSpy = jest.spyOn(connection as any, 'connect')
        ;(connection as any).reconnect()
        expect((connection as any).reconnectionAttemptsMade).toBe(1)
        expect(connectSpy).toHaveBeenCalledTimes(1)
        ;(connection as any).reconnect()
        expect((connection as any).reconnectionAttemptsMade).toBe(2)
        expect(connectSpy).toHaveBeenCalledTimes(2)
        ;(connection as any).reconnect()
        expect((connection as any).reconnectionAttemptsMade).toBe(3)
        expect(connectSpy).toHaveBeenCalledTimes(3)

        expect(() => {
          ;(connection as any).reconnect()
        }).toThrow('Exceeded maximum reconnection attempts')
      })

      it('should reset port to null before reconnecting', () => {
        const connection = new TabConnection(mockTabId)

        expect((connection as any).port).not.toBeNull()
        ;(connection as any).reconnect()

        expect(chrome.tabs.connect).toHaveBeenCalledTimes(2)
      })
    })

    describe('message handler management', () => {
      it('should add message handlers correctly', () => {
        const connection = new TabConnection(mockTabId)
        const handler1 = jest.fn()
        const handler2 = jest.fn()
        connection.addMessageHandler('test-type', handler1)
        connection.addMessageHandler('test-type', handler2)
        const handlers = (connection as any).messageHandlers.get('test-type')

        expect(handlers).toHaveLength(2)
        expect(handlers).toContain(handler1)
        expect(handlers).toContain(handler2)
      })

      it('should remove message handlers correctly', () => {
        const connection = new TabConnection(mockTabId)
        const handler1 = jest.fn()
        const handler2 = jest.fn()
        connection.addMessageHandler('test-type', handler1)
        connection.addMessageHandler('test-type', handler2)
        connection.removeMessageHandler('test-type', handler1)
        const handlers = (connection as any).messageHandlers.get('test-type')

        expect(handlers).toHaveLength(1)
        expect(handlers).not.toContain(handler1)
        expect(handlers).toContain(handler2)
      })

      it('should handle removing a non-existent handler', () => {
        const connection = new TabConnection(mockTabId)
        const handler = jest.fn()

        expect(() => {
          connection.removeMessageHandler('test-type', handler)
        }).not.toThrow()
      })

      it('should handle removing a handler for a non-existent type', () => {
        const connection = new TabConnection(mockTabId)
        const handler = jest.fn()

        expect(() => {
          connection.removeMessageHandler('non-existent-type', handler)
        }).not.toThrow()
      })
    })

    describe('sendMessage', () => {
      it('should send messages through the port', () => {
        const connection = new TabConnection(mockTabId)
        const message = { type: 'test-message' }
        connection.sendMessage(message)

        expect(mockPort.postMessage).toHaveBeenCalledWith(message)
      })

      it('should attempt to reconnect if port is null before sending', () => {
        const connection = new TabConnection(mockTabId)
        ;(connection as any).port = null
        const connectSpy = jest.spyOn(connection as any, 'connect')
        connection.sendMessage({ type: 'test-message' })

        expect(connectSpy).toHaveBeenCalled()
      })

      it('should send to the newly created port after reconnection', () => {
        const connection = new TabConnection(mockTabId)
        const message = { type: 'test-message' }
        const newMockPort = {
          onDisconnect: { addListener: jest.fn() },
          onMessage: { addListener: jest.fn() },
          postMessage: jest.fn()
        }
        ;(connection as any).port = null
        ;(chrome.tabs.connect as jest.Mock).mockReturnValueOnce(newMockPort)
        connection.sendMessage(message)

        expect(newMockPort.postMessage).toHaveBeenCalledWith(message)
      })
    })

    it('should invoke multiple handlers for the same message type', () => {
      const connection = new TabConnection(mockTabId)
      const handler1 = jest.fn()
      const handler2 = jest.fn()

      // Register multiple handlers for the same type
      connection.addMessageHandler('test-type', handler1)
      connection.addMessageHandler('test-type', handler2)

      // Extract the message listener
      const messageCallback = mockPort.onMessage.addListener.mock.calls[0][0]

      // Create a test message
      const testMessage = { type: 'test-type', contents: { data: 'test-data' } }

      // Trigger the message
      messageCallback(testMessage)

      // Verify both handlers were called
      expect(handler1).toHaveBeenCalledWith(testMessage)
      expect(handler2).toHaveBeenCalledWith(testMessage)
    })
  })

  describe('extractJsonFromString', () => {
    test('extracts JSON from text #1', () => {
      const input = {
        text: 'Here is JSON: {"success": true, "count": 42}'
      }
      const expected = { success: true, count: 42 }

      expect(extractJsonFromString(input.text)).toEqual(expected)
    })

    test('extracts JSON from text #2', () => {
      const input = 'Here is a JSON object: {"name": "John", "age": 30}. That is all.'
      const expected = { name: 'John', age: 30 }

      expect(extractJsonFromString(input)).toEqual(expected)
    })

    test('extracts first valid JSON when multiple are present', () => {
      const input = 'Multiple: {"first": true} and then {"second": false}'
      const expected = { first: true }

      expect(extractJsonFromString(input)).toEqual(expected)
    })

    test('handles escaped quotes in JSON strings', () => {
      const input = 'Escaped quotes: {"message": "He said \\"Hello\\""}'
      const expected = { message: 'He said "Hello"' }

      expect(extractJsonFromString(input)).toEqual(expected)
    })

    test('handles JSON within markdown code blocks', () => {
      const input = 'Code block:\n```json\n{"valid": true}\n```\nEnd of block'
      const expected = { valid: true }

      expect(extractJsonFromString(input)).toEqual(expected)
    })

    test('extracts complex JSON from text', () => {
      const input = `Analysis results:

        {
          "summary": {
            "sentiment": "positive",
            "topics": ["technology", "innovation"],
            "metrics": {
              "relevance": 0.92,
              "confidence": 0.85
            }
          },
          "details": [
            {"section": 1, "keywords": ["digital", "transformation"]},
            {"section": 2, "keywords": ["AI", "machine learning"]}
          ]
        }

        End of analysis.`

      const expected = {
        summary: {
          sentiment: 'positive',
          topics: ['technology', 'innovation'],
          metrics: {
            relevance: 0.92,
            confidence: 0.85
          }
        },
        details: [
          { section: 1, keywords: ['digital', 'transformation'] },
          { section: 2, keywords: ['AI', 'machine learning'] }
        ]
      }

      expect(extractJsonFromString(input)).toEqual(expected)
    })

    test('returns null when text field is empty', () => {
      expect(extractJsonFromString('')).toBeNull()
      expect(extractJsonFromString('Lorem ipsum')).toBeNull()
      // @ts-expect-error - testing invalid input
      expect(extractJsonFromString({})).toBeNull()
    })
  })
})
