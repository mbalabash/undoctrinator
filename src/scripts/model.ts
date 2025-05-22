import { AppStates, RenderController } from './render'
import { ExtensionConfig } from './settings'
import {
  ChatCompletion,
  CreateExtensionServiceWorkerMLCEngine,
  InitProgressCallback,
  InitProgressReport,
  MLCEngineInterface
} from '@mlc-ai/web-llm'
import {
  AnthropicRequestMessageStructure,
  OpenAICompatibleRequestMessageStructure,
  prepareMessagesForModelRequest,
  Prompt
} from './prompt'

export const TOKEN_TO_CHAR_APPROXIMATION = 3.6

export type CompletionRequest = {
  prompt: Prompt
  temperature?: number
  maxTokens?: number
}

export type CompletionResponse = {
  text: string
  usage: {
    inputTokens: number
    totalTokens: number
  } | null
}

export interface LLMStrategy {
  id: string
  contextWindowSize: number
  getCompletions(request: CompletionRequest): Promise<CompletionResponse>
  stopGeneration(): void
}

export class ModelController {
  private strategy: LLMStrategy | null = null

  constructor(strategy?: LLMStrategy) {
    if (strategy) {
      this.strategy = strategy
    }
  }

  async initialize(config: ExtensionConfig) {
    if (
      !config.modelToUse.length ||
      config.modelToUse === 'WEBLLM_LLAMA' ||
      config.modelToUse === 'WEBLLM_QWEN' ||
      config.modelToUse === 'WEBLLM_DEEPSEEK_LLAMA' ||
      config.modelToUse === 'WEBLLM_MISTRAL'
    ) {
      const localModelStrategy = new WebLLMStrategy()
      await localModelStrategy.initModel(config.modelToUse)
      this.setStrategy(localModelStrategy)
    } else if (config.modelToUse === 'OPENAI') {
      this.setStrategy(new OpenAIStrategy(config.openAiApiKey))
    } else if (config.modelToUse === 'ANTHROPIC') {
      this.setStrategy(new AnthropicStrategy(config.anthropicApiKey))
    }
  }

  setStrategy(strategy: LLMStrategy) {
    this.strategy = strategy
  }

  getContextWindowSize() {
    if (!this.strategy) {
      throw new Error('To obtain the context window size, the model strategy must be set')
    }

    return this.strategy.contextWindowSize
  }

  getModelId() {
    if (!this.strategy) {
      throw new Error('To obtain the model id, the model strategy must be set')
    }

    return this.strategy.id
  }

  async getCompletions(request: CompletionRequest): Promise<CompletionResponse> {
    if (!this.strategy) {
      throw new Error('To get completions, the model strategy must be set')
    }

    try {
      return this.strategy.getCompletions({ temperature: 0.99, maxTokens: 4000, ...request })
    } catch (error) {
      throw new Error('Failed to get completions', { cause: error })
    }
  }

  stopGeneration() {
    if (!this.strategy) {
      throw new Error('To stop completions generation, the model strategy must be set')
    }

    return this.strategy.stopGeneration()
  }
}

export class WebLLMStrategy implements LLMStrategy {
  contextWindowSize: number = 4096
  id!: string

  constructor() {}

  private model: MLCEngineInterface | undefined

  async initModel(modelName: string) {
    const progressFn: InitProgressCallback = (report: InitProgressReport) => {
      RenderController.getInstance().showModelInitializationProgressBar(report.progress)
    }

    const webllm: MLCEngineInterface = await CreateExtensionServiceWorkerMLCEngine(
      this.getModelIdFromName(modelName),
      {
        initProgressCallback: progressFn
      }
    )

    this.id = modelName
    this.model = webllm

    this.model.resetChat()
  }

  async getCompletions(request: CompletionRequest): Promise<CompletionResponse> {
    if (!this.model) {
      throw new Error('Model is required when using WebLLMStrategy')
    }

    const chunks = await this.model.chat.completions.create({
      // had to use stream because of this bug: https://github.com/mlc-ai/web-llm/issues/447
      stream: true,
      stream_options: { include_usage: true },
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      response_format: { type: 'json_object' },
      messages: prepareMessagesForModelRequest(request.prompt, 'openaiLIKE')
    })
    const response: CompletionResponse = {
      text: '',
      usage: null
    }

    for await (const chunk of chunks) {
      response.text += chunk.choices[0]?.delta.content || ''

      // present only in last chunk
      if (chunk.usage) {
        response.usage = {
          inputTokens: chunk.usage.prompt_tokens,
          totalTokens: chunk.usage.total_tokens
        }
      }
    }

    return response
  }

  stopGeneration() {
    if (!this.model) {
      throw new Error('Model is required when using WebLLMStrategy')
    }

    RenderController.getInstance().transition(AppStates.idle)
    this.model.interruptGenerate()
  }

  private getModelIdFromName(modelName: string) {
    if (modelName === 'WEBLLM_LLAMA') {
      return 'Llama-3.2-3B-Instruct-q4f16_1-MLC'
    } else if (modelName === 'WEBLLM_MISTRAL') {
      return 'Mistral-7B-Instruct-v0.3-q4f16_1-MLC'
    } else if (modelName === 'WEBLLM_QWEN') {
      return 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC'
    } else if (modelName === 'WEBLLM_DEEPSEEK_LLAMA') {
      return 'DeepSeek-R1-Distill-Llama-8B-q4f16_1-MLC'
    } else {
      throw new Error('Model name not recognized')
    }
  }
}

const EXTERNAL_MODELS_ABORT_MESSAGE = 'User stopped the generation'

export class OpenAIStrategy implements LLMStrategy {
  public id: string = 'GPT-4O-MINI'
  public contextWindowSize: number = 128000

  private readonly baseUrl = 'https://api.openai.com/v1/chat/completions'
  private readonly model = 'gpt-4o-mini'
  private apiKey: string = ''

  constructor(
    apiKey: string,
    private abortController: AbortController | null = null
  ) {
    if (!apiKey) {
      throw new Error('API key is required for OpenAIStrategy')
    }
    this.apiKey = apiKey
  }

  async getCompletions(request: CompletionRequest): Promise<CompletionResponse> {
    try {
      const messages = prepareMessagesForModelRequest(request.prompt, 'openaiLIKE')
      const response = await this.makeRequest(messages, request)

      const result = await response.json()
      return {
        text: result.choices[0].message.content,
        usage: {
          inputTokens: result.usage.prompt_tokens,
          totalTokens: result.usage.total_tokens
        }
      }
    } catch (error) {
      if (error === EXTERNAL_MODELS_ABORT_MESSAGE) {
        return { text: '', usage: { inputTokens: 0, totalTokens: 0 } }
      } else {
        throw error instanceof Error ? error : new Error(String(error))
      }
    }
  }

  private async makeRequest(
    messages: OpenAICompatibleRequestMessageStructure,
    request: CompletionRequest
  ) {
    this.abortController = new AbortController()

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'x-api-key': this.apiKey,
        'content-type': 'application/json'
      },
      signal: this.abortController.signal,
      body: JSON.stringify({
        model: this.model,
        messages: messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        response_format: { type: 'json_object' },
        stream: false
      })
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(errorBody)
    }

    return response
  }

  stopGeneration = () => {
    RenderController.getInstance().transition(AppStates.idle)
    this.abortController?.abort(EXTERNAL_MODELS_ABORT_MESSAGE)
  }
}

export class AnthropicStrategy implements LLMStrategy {
  public id: string = 'CLAUDE-3-OPUS'
  public contextWindowSize: number = 200000

  private readonly baseUrl = 'https://api.anthropic.com/v1/messages'
  private readonly model = 'claude-3-opus-latest'
  private apiKey: string = ''

  constructor(
    apiKey: string,
    private abortController: AbortController | null = null
  ) {
    if (!apiKey) {
      throw new Error('API key is required for ClaudeStrategy')
    }
    this.apiKey = apiKey
  }

  async getCompletions(request: CompletionRequest): Promise<CompletionResponse> {
    try {
      const messages = prepareMessagesForModelRequest(request.prompt, 'anthropic')
      const response = await this.makeRequest(messages, request)

      const result = await response.json()
      return {
        text: result.content[0].text,
        usage: {
          inputTokens: result.usage.input_tokens,
          totalTokens: result.usage.output_tokens + result.usage.input_tokens
        }
      }
    } catch (error) {
      if (error === EXTERNAL_MODELS_ABORT_MESSAGE) {
        return { text: '', usage: { inputTokens: 0, totalTokens: 0 } }
      } else {
        throw error instanceof Error ? error : new Error(String(error))
      }
    }
  }

  private async makeRequest(
    messages: AnthropicRequestMessageStructure,
    request: CompletionRequest
  ) {
    this.abortController = new AbortController()

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'x-api-key': this.apiKey,
        'content-type': 'application/json'
      },
      signal: this.abortController.signal,
      body: JSON.stringify({
        model: this.model,
        system: messages.system,
        messages: messages.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stream: false
      })
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(errorBody)
    }

    return response
  }

  stopGeneration = () => {
    RenderController.getInstance().transition(AppStates.idle)
    this.abortController?.abort(EXTERNAL_MODELS_ABORT_MESSAGE)
  }
}
