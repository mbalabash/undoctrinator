import {
  craftInstructions,
  prepareMessagesForModelRequest,
  IntensityLevel
} from '../src/scripts/prompt'

describe('craftInstructions', () => {
  it('should match snapshot for basic text analysis prompt', () => {
    const text = 'This is a basic text that needs analysis.'
    const prompt = craftInstructions(text)

    expect(prompt).toMatchSnapshot()
  })
})

describe('prepareMessagesForModelRequest', () => {
  const samplePrompt = craftInstructions('This is a basic text that needs analysis.')

  it('should match snapshot for OpenAI message format', () => {
    const openaiFormat = prepareMessagesForModelRequest(samplePrompt, 'openaiLIKE')

    expect(openaiFormat).toMatchSnapshot()
  })

  it('should match snapshot for Anthropic message format', () => {
    const anthropicFormat = prepareMessagesForModelRequest(samplePrompt, 'anthropic')

    expect(anthropicFormat).toMatchSnapshot()
  })
})

describe('intensityLevel', () => {
  it('should match expected IntensityLevel structure', () => {
    expect(IntensityLevel).toMatchSnapshot()
  })
})
