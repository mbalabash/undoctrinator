import { getExtensionConfigFromStorage } from './utils'

type ModelType =
  | 'WEBLLM_LLAMA'
  | 'WEBLLM_MISTRAL'
  | 'WEBLLM_QWEN'
  | 'WEBLLM_DEEPSEEK_LLAMA'
  | 'OPENAI'
  | 'ANTHROPIC'

export type ExtensionConfig = {
  modelToUse: ModelType
  openAiApiKey: string
  anthropicApiKey: string
}

export class ConfigManager {
  private static readonly POSSIBLE_MODELS: ModelType[] = [
    'WEBLLM_LLAMA',
    'WEBLLM_MISTRAL',
    'WEBLLM_QWEN',
    'WEBLLM_DEEPSEEK_LLAMA',
    'OPENAI',
    'ANTHROPIC'
  ]

  static validateModelType(model: string): model is ModelType {
    return this.POSSIBLE_MODELS.includes(model as ModelType)
  }

  static async saveModelChoice(model: ModelType): Promise<void> {
    await chrome.storage.sync.set({ modelToUse: model })
  }

  static async saveApiKey(provider: 'openai' | 'anthropic', key: string): Promise<void> {
    const storageKey = provider === 'openai' ? 'openAiApiKey' : 'anthropicApiKey'
    await chrome.storage.sync.set({ [storageKey]: key })
  }
}

export class SettingsUIManager {
  private elements: {
    modelInputs: NodeListOf<HTMLInputElement>
    openAiInput: HTMLInputElement
    anthropicInput: HTMLInputElement
  }

  constructor() {
    const modelInputs = document.querySelectorAll<HTMLInputElement>('input[name="modelToUse"]')
    const openAiInput = document.getElementById('openAiApiKeyInput') as HTMLInputElement
    const anthropicInput = document.getElementById('anthropicApiKeyInput') as HTMLInputElement

    if (!modelInputs.length || !openAiInput || !anthropicInput) {
      throw new Error('Required UI elements not found')
    }

    this.elements = { modelInputs, openAiInput, anthropicInput }
  }

  initializeUI(config: ExtensionConfig): void {
    this.elements.modelInputs.forEach(input => {
      input.checked = input.value === config.modelToUse
    })
    this.elements.openAiInput.value = config.openAiApiKey
    this.elements.anthropicInput.value = config.anthropicApiKey

    this.updateInputStates(config.modelToUse)
  }

  setupEventListeners(): void {
    this.elements.modelInputs.forEach(input => {
      input.addEventListener('change', () => this.handleModelChange(input))
    })

    this.elements.openAiInput.addEventListener('change', e =>
      this.handleApiKeyChange('openai', (e.target as HTMLInputElement).value)
    )

    this.elements.anthropicInput.addEventListener('change', e =>
      this.handleApiKeyChange('anthropic', (e.target as HTMLInputElement).value)
    )
  }

  private updateInputStates(modelToUse: ModelType): void {
    const isWebLLM = modelToUse.startsWith('WEBLLM_')

    this.elements.openAiInput.disabled = isWebLLM || modelToUse === 'ANTHROPIC'
    this.elements.anthropicInput.disabled = isWebLLM || modelToUse === 'OPENAI'
  }

  private async handleModelChange(input: HTMLInputElement): Promise<void> {
    if (input.checked && ConfigManager.validateModelType(input.value)) {
      await ConfigManager.saveModelChoice(input.value as ModelType)
      this.updateInputStates(input.value as ModelType)
    }
  }

  private async handleApiKeyChange(provider: 'openai' | 'anthropic', value: string): Promise<void> {
    await ConfigManager.saveApiKey(provider, value)
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const config = await getExtensionConfigFromStorage()
    const uiManager = new SettingsUIManager()

    uiManager.initializeUI(config)
    uiManager.setupEventListeners()
  } catch (error) {
    console.error('Failed to initialize settings page:', error)
  }
})
