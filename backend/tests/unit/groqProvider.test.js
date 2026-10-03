/**
 * Contract Tests — the Groq provider adapter
 *
 * The seam is only useful if the real adapter translates the SDK's shapes
 * correctly, so the SDK is replaced here with a fake that reports the request it
 * was given and returns an SDK-shaped response. This is the one place that tests
 * the vendor boundary itself; everything else in the AI suites is vendor
 * agnostic by design.
 */

import { jest } from "@jest/globals";

const chatCompletionsCreate = jest.fn();
const groqConstructor = jest.fn(function GroqFake(options) {
  this.options = options;
  this.chat = { completions: { create: chatCompletionsCreate } };
});

jest.unstable_mockModule("groq-sdk", () => ({ default: groqConstructor }));

const MESSAGES = [{ role: "user", content: "hello" }];

// The adapter memoises its client in module scope, so the module is re-imported
// per test to keep the client-lifecycle assertions independent of test order.
let createGroqProvider;

const sdkResponse = (content, usage = { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 }) => ({
  choices: [{ message: { content } }],
  usage,
});

let originalKey;
let originalModel;

beforeEach(async () => {
  originalKey = process.env.GROQ_API_KEY;
  originalModel = process.env.GROQ_MODEL;
  // Pinned so the default-model assertions below are not at the mercy of the
  // environment the suite happens to run in.
  delete process.env.GROQ_MODEL;
  process.env.GROQ_API_KEY = "test-key-not-real";
  chatCompletionsCreate.mockReset();
  groqConstructor.mockClear();
  jest.resetModules();
  ({ createGroqProvider } = await import("../../services/groqProvider.js"));
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalKey;
  if (originalModel === undefined) delete process.env.GROQ_MODEL;
  else process.env.GROQ_MODEL = originalModel;
});

describe("createGroqProvider", () => {
  test("maps a completion onto the plain content contract", async () => {
    chatCompletionsCreate.mockResolvedValue(sdkResponse("hello there"));

    const result = await createGroqProvider().complete({ messages: MESSAGES });

    expect(result).toEqual({
      content: "hello there",
      usage: { promptTokens: 11, completionTokens: 22, totalTokens: 33 },
    });
  });

  test("translates the request into the SDK's parameter names", async () => {
    chatCompletionsCreate.mockResolvedValue(sdkResponse("ok"));

    await createGroqProvider().complete({
      messages: MESSAGES,
      temperature: 0.25,
      maxTokens: 2048,
      model: "custom-model",
    });

    expect(chatCompletionsCreate).toHaveBeenCalledWith({
      model: "custom-model",
      messages: MESSAGES,
      temperature: 0.25,
      max_tokens: 2048,
    });
  });

  test("falls back to the default model when none is given", async () => {
    chatCompletionsCreate.mockResolvedValue(sdkResponse("ok"));

    await createGroqProvider().complete({ messages: MESSAGES });

    // A provider-side model retirement must never again require a code change to
    // the services that call this adapter, so the default is asserted here rather
    // than at any call site.
    expect(chatCompletionsCreate.mock.calls[0][0].model).toBe("openai/gpt-oss-120b");
  });

  test("honours GROQ_MODEL from the environment", async () => {
    // The module reads the variable when it is first evaluated, so it has to be
    // set before the re-import.
    process.env.GROQ_MODEL = "vendor/some-other-model";
    jest.resetModules();
    ({ createGroqProvider } = await import("../../services/groqProvider.js"));
    chatCompletionsCreate.mockResolvedValue(sdkResponse("ok"));

    await createGroqProvider().complete({ messages: MESSAGES });

    expect(chatCompletionsCreate.mock.calls[0][0].model).toBe("vendor/some-other-model");
  });

  test("an explicit model still wins over GROQ_MODEL", async () => {
    process.env.GROQ_MODEL = "vendor/some-other-model";
    jest.resetModules();
    ({ createGroqProvider } = await import("../../services/groqProvider.js"));
    chatCompletionsCreate.mockResolvedValue(sdkResponse("ok"));

    await createGroqProvider().complete({ messages: MESSAGES, model: "caller/model" });

    expect(chatCompletionsCreate.mock.calls[0][0].model).toBe("caller/model");
  });

  test("leaves content undefined when the response carries no message", async () => {
    chatCompletionsCreate.mockResolvedValue({ choices: [] });

    const result = await createGroqProvider().complete({ messages: MESSAGES });

    // Deliberately not coerced to "": deciding what an absent body means is the
    // caller's job, and the AI suites pin that behaviour.
    expect(result.content).toBeUndefined();
  });

  test("re-requests the stream and rewrites delta chunks as content chunks", async () => {
    async function* upstream() {
      yield { choices: [{ delta: { content: "Hel" } }] };
      yield { choices: [{ delta: { content: "lo" } }] };
      yield { choices: [{ delta: {} }] };
      yield {};
    }
    chatCompletionsCreate.mockResolvedValue(upstream());

    const stream = await createGroqProvider().stream({ messages: MESSAGES, maxTokens: 2500 });
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);

    expect(chatCompletionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      messages: MESSAGES,
      max_tokens: 2500,
      stream: true,
    }));
    expect(chunks).toEqual([{ content: "Hel" }, { content: "lo" }, { content: "" }, { content: "" }]);
  });

  test("refuses to make a request when no API key is configured", async () => {
    delete process.env.GROQ_API_KEY;

    await expect(createGroqProvider().complete({ messages: MESSAGES }))
      .rejects.toThrow("GROQ_API_KEY is not set");
    await expect(createGroqProvider().stream({ messages: MESSAGES }))
      .rejects.toThrow("GROQ_API_KEY is not set");

    // No client is built and no request is attempted, so a misconfigured
    // deployment fails immediately instead of reaching the network.
    expect(groqConstructor).not.toHaveBeenCalled();
    expect(chatCompletionsCreate).not.toHaveBeenCalled();
  });

  test("reuses one client across calls", async () => {
    chatCompletionsCreate.mockResolvedValue(sdkResponse("ok"));
    const provider = createGroqProvider();

    await provider.complete({ messages: MESSAGES });
    await provider.complete({ messages: MESSAGES });

    expect(groqConstructor).toHaveBeenCalledTimes(1);
    expect(groqConstructor).toHaveBeenCalledWith({ apiKey: "test-key-not-real" });
  });
});
