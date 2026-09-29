/**
 * AI provider seam.
 *
 * Every model call in the application goes through this module, so the AI layer
 * is a replaceable dependency rather than something hard-wired to the Groq SDK.
 * Production resolves to the Groq provider; tests inject a deterministic
 * implementation and never need an API key or a network.
 *
 * The interface is deliberately narrow — a completion and a stream — because
 * that is all the application actually asks of a model. Provider-specific
 * response shapes belong in the provider, not in the services, so that a change
 * of vendor does not ripple into parsing code.
 *
 * @typedef {Object} AICompletionRequest
 * @property {Array<{ role: string, content: string }>} messages
 * @property {number} [temperature]
 * @property {number} [maxTokens]
 * @property {string} [model]
 *
 * @typedef {Object} AICompletionResult
 * @property {string|undefined} content Raw text as the model returned it. It is
 *   intentionally not coerced: deciding what to do with an absent or malformed
 *   body is the caller's job, and that decision is what the tests exercise.
 * @property {{ promptTokens?: number, completionTokens?: number, totalTokens?: number }} [usage]
 *
 * @typedef {Object} AIStreamChunk
 * @property {string} content
 *
 * @typedef {Object} AIProvider
 * @property {(request: AICompletionRequest) => Promise<AICompletionResult>} complete
 * @property {(request: AICompletionRequest) => Promise<AsyncIterable<AIStreamChunk>>} stream
 */

import { createGroqProvider } from "./groqProvider.js";

let activeProvider = null;

/** Replaces the active provider. Intended for tests and for future vendor swaps. */
export const setAIProvider = (provider) => {
  activeProvider = provider;
};

/** Restores the default provider. Tests should call this between cases. */
export const resetAIProvider = () => {
  activeProvider = null;
};

export const getAIProvider = () => {
  if (!activeProvider) activeProvider = createGroqProvider();
  return activeProvider;
};
