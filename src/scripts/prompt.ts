import { ChatCompletionMessageParam } from '@mlc-ai/web-llm'
import { removeExtraWhitespaces } from './utils'

export type Prompt = {
  system: string
  user: string
}

export const IntensityLevel = {
  NONE: 'NONE',
  WEAK: 'WEAK',
  MODERATE: 'MODERATE',
  STRONG: 'STRONG',
  EXTREME: 'EXTREME'
} as const
export type IntensityLevels = (typeof IntensityLevel)[keyof typeof IntensityLevel]

interface AnalysisItem {
  quote: string
  explanation: string
}
interface IdeologicalItem extends AnalysisItem {
  associatedIdeology: string
}
interface EmotionalItem extends AnalysisItem {
  targetEmotion: string
}
interface LogicalItem extends AnalysisItem {
  fallacyType: string
}

export type ModelResponse = {
  emotionalManipulationStrength: IntensityLevels
  ideologicalStrength: IntensityLevels
  ideologicalMarkers: IdeologicalItem[]
  promotedValues: IdeologicalItem[]
  emotionalManipulations: EmotionalItem[]
  logicalFallacies: LogicalItem[]
}
export const proofsValueKeys = [
  'ideologicalMarkers',
  'promotedValues',
  'emotionalManipulations',
  'logicalFallacies'
] as const

export function craftInstructions(text: string): Prompt {
  if (!text.trim()) {
    throw new Error('Text parameter is required and cannot be empty')
  }

  const intensityKeywords = ['NONE', 'WEAK', 'MODERATE', 'STRONG', 'EXTREME'].join(' | ')

  const prompt = {
    system: `
        You are a media analysis assistant specializing in identifying manipulation tactics and bias in text.
        Your task is to analyze the provided text and generate a structured, evidence-based report in JSON format.
        Follow the detailed framework below to ensure comprehensive analysis:
        1. Requirements:
          - Evaluate both explicit and subtle manipulation tactics.
          - Base your analysis on clear, evidence-backed reasoning.
          - Include direct quotes for all identified elements.
          - Provide a concise explanation for each identified tactic, justifying why it qualifies as manipulation or bias.
          - Rate intensity levels as: ${intensityKeywords}.
          - Your response must be formatted as a properly structured JSON object.
        2. Analysis Framework:
          A) Claims and Logic:
            - Identify unsupported or unverifiable claims.
            - Detect logical fallacies.
            - Evaluate the coherence and consistency of arguments.
          B) Emotional Manipulations:
            - Recognize sensationalist language and hyperbole.
            - Identify emotional manipulation strategies.
            - Spot oversimplifications of complex issues.
            - Detect clickbait elements or misleading headlines.
            - Highlight loaded terms, charged language, or exaggerated claims.
            - Note out-of-context data, meaningless comparisons, or correlation-causation fallacies.
            - Flag anonymous or vague sources and appeals to false authority.
            - Identify instances of missing context or lack of diverse perspectives.
            - Assess fear-mongering, urgency creation, bandwagon effects, or social proof manipulation.
            - Evaluate false scarcity tactics, gaslighting techniques, guilt-tripping, and in-group vs. out-group framing.
          C) Political Ideology:
            - Detect ideological markers or affiliations.
            - Assess the strength and influence of ideological bias.
          D) Promoted Values:
            - Highlight explicitly or implicitly promoted values or agendas.
        3. Output Format:
          {
            ideologicalStrength: ${intensityKeywords},
            emotionalManipulationStrength: ${intensityKeywords},
            ideologicalMarkers: { quote: string, explanation: string, associatedIdeology: string }[],
            promotedValues: { quote: string, explanation: string, associatedIdeology: string }[],
            emotionalManipulations: { quote: string, explanation: string, targetEmotion: string }[],
            logicalFallacies: { quote: string, explanation: string, fallacyType: string }[],
          }
    `,
    user: `
      TEXT TO ANALYZE:
      """
      ${text}
      """
    `
  }

  prompt.system = removeExtraWhitespaces(prompt.system)
  prompt.user = removeExtraWhitespaces(prompt.user)

  return prompt
}

export type AnthropicRequestMessageStructure = {
  system?: string
  messages?: Array<{ role: string; content: Array<{ type: string; text: string }> }>
}
export type OpenAICompatibleRequestMessageStructure = ChatCompletionMessageParam[]

export function prepareMessagesForModelRequest<T extends 'openaiLIKE' | 'anthropic'>(
  prompt: Prompt,
  type: T
): T extends 'openaiLIKE'
  ? OpenAICompatibleRequestMessageStructure
  : AnthropicRequestMessageStructure {
  if (!prompt.system && !prompt.user) {
    throw new Error('At least one of system or user messages must be provided')
  }

  if (type === 'openaiLIKE') {
    const result: OpenAICompatibleRequestMessageStructure = []

    if (prompt.system) {
      result.push({ role: 'system', content: prompt.system })
    }
    if (prompt.user) {
      result.push({ role: 'user', content: prompt.user })
    }

    return result as unknown as T extends 'openaiLIKE'
      ? OpenAICompatibleRequestMessageStructure
      : AnthropicRequestMessageStructure
  } else {
    const result: AnthropicRequestMessageStructure = {}

    if (prompt.system) {
      result['system'] = prompt.system
    }
    if (prompt.user) {
      result['messages'] = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt.user
            }
          ]
        }
      ]
    }

    return result as unknown as T extends 'openaiLIKE'
      ? OpenAICompatibleRequestMessageStructure
      : AnthropicRequestMessageStructure
  }
}
