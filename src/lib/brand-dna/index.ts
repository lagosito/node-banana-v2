/**
 * Brand DNA Pipeline — Public API
 */

export { extractBrandDNA } from './extractor'
export type { ExtractOptions } from './extractor'

export { scoreICP, DEFAULT_ICP } from './scorer'

export { detectSignals, extractWithSignals } from './signal-detector'
export type { SignalDetectionOptions, SignalDetectionResult } from './signal-detector'

export { generatePersonas, extractFullIntelligence } from './persona-generator'
export type { PersonaGenerationOptions, PersonaGenerationResult } from './persona-generator'

export { discoverLookalikes, extractWithLookalikes } from './lookalike-discovery'
export type { LookalikeOptions, LookalikeResult } from './lookalike-discovery'

export type {
  BrandDNA,
  DigitalMaturity,
  TechStack,
  CompanySignal,
  SignalType,
  ICPProfile,
  ICPScore,
  BrandDNARequest,
  BrandDNAResponse,
  BuyerPersona,
} from './types'
