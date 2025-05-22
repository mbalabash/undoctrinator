import {
  MLCEngineInterface,
  CreateExtensionServiceWorkerMLCEngine,
  ChatCompletion
} from '@mlc-ai/web-llm'
import {
  ModelController,
  WebLLMStrategy,
  OpenAIStrategy,
  AnthropicStrategy,
  CompletionRequest
} from '../src/scripts/model'

const mockRenderControllerInstance = {
  transition: jest.fn(),
  progressBars: {
    modelProgressBar: {
      animate: jest.fn(),
      extra: {}
    },
    extra: {}
  }
}

jest.mock('../src/scripts/render', () => ({
  RenderController: {
    getInstance: jest.fn(() => mockRenderControllerInstance)
  },
  AppStates: {
    idle: 'idle'
  }
}))

jest.mock('@mlc-ai/web-llm', () => {
  return {
    InitProgressCallback: jest.fn(),
    InitProgressReport: jest.fn(),
    MLCEngineInterface: jest.fn(),
    CreateExtensionServiceWorkerMLCEngine: jest.fn(),
    ChatCompletion: jest.fn()
  }
})

global.fetch = jest.fn()

describe('ModelController', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  test('getContextWindowSize throws error if no strategy', () => {
    const controller = new ModelController()

    expect(() => controller.getContextWindowSize()).toThrowError(
      'To obtain the context window size, the model strategy must be set'
    )
  })

  test('getModelId throws error if no strategy', () => {
    const controller = new ModelController()

    expect(() => controller.getModelId()).toThrowError(
      'To obtain the model id, the model strategy must be set'
    )
  })

  test('getCompletions throws error if no strategy', async () => {
    const controller = new ModelController()

    await expect(
      controller.getCompletions({ prompt: { system: 'system prompt', user: 'user prompt' } })
    ).rejects.toThrowError('To get completions, the model strategy must be set')
  })

  test('stopGeneration throws error if no strategy', () => {
    const controller = new ModelController()

    expect(() => controller.stopGeneration()).toThrowError(
      'To stop completions generation, the model strategy must be set'
    )
  })

  test('getCompletions calls strategy.getCompletions with defaults merged', async () => {
    const mockStrategy = {
      id: 'TEST_STRATEGY',
      contextWindowSize: 1234,
      getCompletions: jest.fn().mockResolvedValue({
        text: 'test-completion',
        usage: {
          promptTokens: 10,
          totalTokens: 20
        }
      }),
      stopGeneration: jest.fn()
    }
    const controller = new ModelController(mockStrategy)
    const request = {
      prompt: { messages: [{ role: 'user', content: 'Hello' }] },
      temperature: 0.5,
      maxTokens: 100
    }
    const result = await controller.getCompletions(request as unknown as CompletionRequest)

    expect(mockStrategy.getCompletions).toHaveBeenCalledWith({
      prompt: request.prompt,
      temperature: 0.5,
      maxTokens: 100
    })
    expect(result).toEqual({
      text: 'test-completion',
      usage: { promptTokens: 10, totalTokens: 20 }
    })
  })

  test('stopGeneration calls strategy.stopGeneration', () => {
    const mockStrategy = {
      id: 'TEST_STRATEGY',
      contextWindowSize: 1234,
      getCompletions: jest.fn(),
      stopGeneration: jest.fn()
    }
    const controller = new ModelController(mockStrategy)
    controller.stopGeneration()

    expect(mockStrategy.stopGeneration).toHaveBeenCalled()
  })
})

describe('WebLLMStrategy', () => {
  let strategy: WebLLMStrategy

  const mockModel: MLCEngineInterface = {
    resetChat: jest.fn(),
    interruptGenerate: jest.fn(),
    chat: {
      completions: {
        create: jest.fn()
      }
    }
  } as unknown as MLCEngineInterface

  beforeEach(() => {
    strategy = new WebLLMStrategy()
    ;(CreateExtensionServiceWorkerMLCEngine as jest.Mock).mockResolvedValue(mockModel)
    jest.clearAllMocks()
  })

  test('initModel calls CreateExtensionServiceWorkerMLCEngine with correct Llama model name', async () => {
    await strategy.initModel('WEBLLM_LLAMA')

    expect(CreateExtensionServiceWorkerMLCEngine).toHaveBeenCalledWith(
      'Llama-3.2-3B-Instruct-q4f16_1-MLC',
      expect.any(Object)
    )
    expect(mockModel.resetChat).toHaveBeenCalled()
    expect(strategy.id).toBe('WEBLLM_LLAMA')
  })

  test('initModel calls CreateExtensionServiceWorkerMLCEngine with correct Mistral model name', async () => {
    await strategy.initModel('WEBLLM_MISTRAL')

    expect(CreateExtensionServiceWorkerMLCEngine).toHaveBeenCalledWith(
      'Mistral-7B-Instruct-v0.3-q4f16_1-MLC',
      expect.any(Object)
    )
    expect(mockModel.resetChat).toHaveBeenCalled()
    expect(strategy.id).toBe('WEBLLM_MISTRAL')
  })

  test('getCompletions throws error if this.model is undefined', async () => {
    const uninitializedStrategy = new WebLLMStrategy()

    await expect(
      uninitializedStrategy.getCompletions({
        prompt: { system: 'system prompt', user: 'user prompt' }
      })
    ).rejects.toThrow('Model is required when using WebLLMStrategy')
  })

  test('getCompletions succeeds and returns correct completion response', async () => {
    strategy['model'] = mockModel
    const mockChatCompletion = [
      {
        choices: [
          {
            delta: {
              role: 'assistant',
              content: 'Hello from WebLLM'
            }
          }
        ]
      }
    ]
    ;(mockModel.chat.completions.create as jest.Mock).mockResolvedValue(mockChatCompletion)
    const response = await strategy.getCompletions({
      prompt: { system: 'system prompt', user: 'user prompt' },
      temperature: 0.9,
      maxTokens: 200
    })

    expect(response).toEqual({
      text: 'Hello from WebLLM',
      usage: null
    })
  })

  test('getCompletions usage is null if usage not present in completion', async () => {
    strategy['model'] = mockModel
    const mockChatCompletion = [
      {
        choices: [
          {
            delta: {
              role: 'assistant',
              content: 'Hello from WebLLM'
            }
          }
        ]
      }
    ]
    ;(mockModel.chat.completions.create as jest.Mock).mockResolvedValue(mockChatCompletion)
    const response = await strategy.getCompletions({
      prompt: { system: 'system prompt', user: 'user prompt' }
    })

    expect(response).toEqual({
      text: 'Hello from WebLLM',
      usage: null
    })
  })

  test('stopGeneration throws error if model is undefined', () => {
    const uninitializedStrategy = new WebLLMStrategy()

    expect(() => uninitializedStrategy.stopGeneration()).toThrow(
      'Model is required when using WebLLMStrategy'
    )
  })

  test('stopGeneration calls model.interruptGenerate when model is available', () => {
    strategy['model'] = mockModel
    strategy.stopGeneration()

    expect(mockModel.interruptGenerate).toHaveBeenCalled()
  })
})

describe('OpenAIStrategy', () => {
  let strategy: OpenAIStrategy
  const mockApiKey = 'test-api-key'

  beforeEach(() => {
    jest.clearAllMocks()
    strategy = new OpenAIStrategy(mockApiKey)
  })

  test('getCompletions returns abort response if error is EXTERNAL_MODELS_ABORT_MESSAGE', async () => {
    ;(global.fetch as jest.Mock).mockRejectedValue('User stopped the generation')
    const res = await strategy.getCompletions({
      prompt: { system: 'system prompt', user: 'user prompt' }
    })

    expect(res).toEqual({ text: '', usage: { inputTokens: 0, totalTokens: 0 } })
  })

  test('getCompletions re-throws non-abort errors as Error instances', async () => {
    ;(global.fetch as jest.Mock).mockRejectedValue(new Error('Some network error'))

    await expect(
      strategy.getCompletions({ prompt: { system: 'system prompt', user: 'user prompt' } })
    ).rejects.toThrow('Some network error')
  })

  test('getCompletions succeeds with correct usage', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Hello from GPT-4O-MINI'
            }
          }
        ],
        usage: {
          prompt_tokens: 20,
          total_tokens: 50
        }
      })
    })
    const result = await strategy.getCompletions({
      prompt: { system: 'system prompt', user: 'user prompt' },
      temperature: 0.7,
      maxTokens: 150
    })

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.any(Object),
        body: expect.stringContaining('"model":"gpt-4o-mini"')
      })
    )
    expect(result).toEqual({
      text: 'Hello from GPT-4O-MINI',
      usage: {
        inputTokens: 20,
        totalTokens: 50
      }
    })
  })

  test('stopGeneration calls abortController.abort', () => {
    const abortController = ((strategy as any).abortController = new AbortController())
    jest.spyOn(abortController, 'abort')
    strategy.stopGeneration()

    expect(abortController.signal.aborted).toBe(true)
  })

  test('getCompletions throws an error if response not ok', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      text: jest.fn().mockResolvedValue('Unauthorized')
    })

    await expect(
      strategy.getCompletions({ prompt: { system: 'system prompt', user: 'user prompt' } })
    ).rejects.toThrow('Unauthorized')
  })
})

describe('ClaudeStrategy', () => {
  let strategy: AnthropicStrategy
  const mockApiKey = 'test-api-key'

  beforeEach(() => {
    jest.clearAllMocks()
    strategy = new AnthropicStrategy(mockApiKey)
  })

  test('getCompletions returns abort response if error is EXTERNAL_MODELS_ABORT_MESSAGE', async () => {
    ;(global.fetch as jest.Mock).mockRejectedValue('User stopped the generation')
    const res = await strategy.getCompletions({
      prompt: { system: 'system prompt', user: 'user prompt' }
    })

    expect(res).toEqual({ text: '', usage: { inputTokens: 0, totalTokens: 0 } })
  })

  test('getCompletions re-throws non-abort errors', async () => {
    ;(global.fetch as jest.Mock).mockRejectedValue(new Error('Network error for Claude'))

    await expect(
      strategy.getCompletions({ prompt: { system: 'system prompt', user: 'user prompt' } })
    ).rejects.toThrow('Network error for Claude')
  })

  test('getCompletions returns correct usage on success', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        content: [{ text: 'Hello from Claude' }],
        usage: {
          input_tokens: 40,
          output_tokens: 10
        }
      })
    })
    const res = await strategy.getCompletions({
      prompt: { system: 'system prompt', user: 'user prompt' },
      temperature: 0.5,
      maxTokens: 100
    })

    expect(res).toEqual({
      text: 'Hello from Claude',
      usage: {
        inputTokens: 40,
        totalTokens: 50
      }
    })
  })

  test('getCompletions throws an error if response not ok', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      text: jest.fn().mockResolvedValue('Bad Request from Anthropic')
    })

    await expect(
      strategy.getCompletions({ prompt: { system: 'system prompt', user: 'user prompt' } })
    ).rejects.toThrow('Bad Request from Anthropic')
  })

  test('stopGeneration calls abortController.abort', () => {
    const abortController = ((strategy as any).abortController = new AbortController())
    jest.spyOn(abortController, 'abort')
    strategy.stopGeneration()

    expect(abortController.signal.aborted).toBe(true)
  })
})
