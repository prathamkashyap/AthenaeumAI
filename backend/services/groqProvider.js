/**
 * Groq implementation of the AI provider interface.
 *
 * This is the only module that knows the Groq SDK exists. It owns client
 * construction, the API-key requirement, and translation of the SDK's response
 * shape into the plain `{ content }` contract the rest of the application uses.
 */

import Groq from "groq-sdk";

const DEFAULT_MODEL = "llama-3.3-70b-versatile";

let groqClient = null;

const getGroqClient = () => {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set");
  }
  if (!groqClient) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
};

const buildRequest = ({ messages, temperature, maxTokens, model }) => ({
  model: model || DEFAULT_MODEL,
  messages,
  temperature,
  max_tokens: maxTokens,
});

/** Rewrites the SDK's delta stream as a stream of plain content chunks. */
async function* toContentChunks(upstream) {
  for await (const chunk of upstream) {
    yield { content: chunk?.choices?.[0]?.delta?.content || "" };
  }
}

export const createGroqProvider = () => ({
  async complete({ messages, temperature, maxTokens, model } = {}) {
    const response = await getGroqClient().chat.completions.create(
      buildRequest({ messages, temperature, maxTokens, model }),
    );

    return {
      content: response?.choices?.[0]?.message?.content,
      usage: {
        promptTokens: response?.usage?.prompt_tokens,
        completionTokens: response?.usage?.completion_tokens,
        totalTokens: response?.usage?.total_tokens,
      },
    };
  },

  async stream({ messages, temperature, maxTokens, model } = {}) {
    const upstream = await getGroqClient().chat.completions.create({
      ...buildRequest({ messages, temperature, maxTokens, model }),
      stream: true,
    });
    return toContentChunks(upstream);
  },
});
