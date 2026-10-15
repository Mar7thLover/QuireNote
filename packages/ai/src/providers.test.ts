import { describe, expect, it } from "vitest";
import { z } from "zod";
import { generateChatText, generateStructured, streamChat } from "./chat";
import { listModels, testConnection } from "./connection";
import { embedTexts } from "./embedding";
import { comfyWorkflow, generateImageFile } from "./image";
import { webSearch } from "./search";
import { synthesizeSpeech, transcribeAudio } from "./speech";
import type { ModelRef, ProviderRuntime } from "./types";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  bodyRaw: unknown;
}

type Handler = (call: Call) => Response | Promise<Response>;

/** 记录请求并按 handler 返回响应的 fetch mock。 */
function mockFetch(handler: Handler) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const call: Call = {
      url,
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : null,
      bodyRaw: init?.body,
    };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { fetch: fn, calls };
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function rt(
  kind: ProviderRuntime["kind"],
  f: typeof fetch,
  extra: Partial<ProviderRuntime> = {},
): ProviderRuntime {
  return { id: `p_${kind}`, kind, apiKey: "test-key-1234", fetch: f, ...extra };
}

const openaiCompletion = (content: string) =>
  json({
    id: "chatcmpl-1",
    object: "chat.completion",
    created: 1,
    model: "gpt-test",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });

describe("chat adapters", () => {
  it("openai: builds a chat completions request and parses the answer", async () => {
    const m = mockFetch(() => openaiCompletion("你好 [1]"));
    const ref: ModelRef = { provider: rt("openai", m.fetch), model: "gpt-6.1-sol" };
    const text = await generateChatText(ref, { system: "sys", prompt: "hi", localText: () => "" });
    expect(text).toBe("你好 [1]");
    const c = m.calls[0]!;
    expect(c.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(c.headers.authorization).toBe("Bearer test-key-1234");
    const body = JSON.parse(c.body!);
    expect(body.model).toBe("gpt-6.1-sol");
    expect(body.messages[0].role).toMatch(/system|developer/);
    expect(body.messages.at(-1)).toMatchObject({ role: "user" });
  });

  it("openai: streams SSE deltas", async () => {
    const chunk = (content: string) =>
      `data: ${JSON.stringify({
        id: "c",
        object: "chat.completion.chunk",
        created: 1,
        model: "m",
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      })}\n\n`;
    const sse = `${chunk("Hel")}${chunk("lo [1]")}data: ${JSON.stringify({
      id: "c",
      object: "chat.completion.chunk",
      created: 1,
      model: "m",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    })}\n\ndata: [DONE]\n\n`;
    const m = mockFetch(() => new Response(sse, { headers: { "content-type": "text/event-stream" } }));
    const ref: ModelRef = { provider: rt("openai", m.fetch), model: "gpt-x" };
    const parts: string[] = [];
    for await (const d of streamChat(ref, { system: "s", messages: [{ role: "user", content: "q" }] }))
      parts.push(d);
    expect(parts.join("")).toBe("Hello [1]");
    expect(JSON.parse(m.calls[0]!.body!).stream).toBe(true);
  });

  it("openai: surfaces HTTP errors from the stream", async () => {
    const m = mockFetch(() => json({ error: { message: "Incorrect API key provided" } }, 401));
    const ref: ModelRef = { provider: rt("openai", m.fetch), model: "gpt-x" };
    await expect(async () => {
      for await (const _ of streamChat(ref, { system: "s", messages: [{ role: "user", content: "q" }] })) {
        /* drain */
      }
    }).rejects.toThrow(/API key|401/);
  });

  it("anthropic: uses the messages API with x-api-key and never the env base url", async () => {
    const m = mockFetch(() =>
      json({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: [{ type: "text", text: "Claude says hi" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 3 },
      }),
    );
    const ref: ModelRef = { provider: rt("anthropic", m.fetch), model: "claude-sonnet-5-5" };
    const text = await generateChatText(ref, { system: "be brief", prompt: "hi", localText: () => "" });
    expect(text).toBe("Claude says hi");
    const c = m.calls[0]!;
    expect(c.url).toBe("https://api.anthropic.com/v1/messages");
    expect(c.headers["x-api-key"]).toBe("test-key-1234");
    const body = JSON.parse(c.body!);
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(JSON.stringify(body.system)).toContain("be brief");
  });

  it("google: calls generateContent with x-goog-api-key", async () => {
    const m = mockFetch(() =>
      json({
        candidates: [{ content: { parts: [{ text: "Gemini here" }], role: "model" }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 },
      }),
    );
    const ref: ModelRef = { provider: rt("google", m.fetch), model: "gemini-3.8-flash" };
    expect(await generateChatText(ref, { system: "s", prompt: "hi", localText: () => "" })).toBe(
      "Gemini here",
    );
    expect(m.calls[0]!.url).toContain("/v1beta/models/gemini-3.8-flash:generateContent");
    expect(m.calls[0]!.headers["x-goog-api-key"]).toBe("test-key-1234");
  });

  it("ollama: uses the OpenAI-compatible endpoint on localhost without a key", async () => {
    const m = mockFetch(() => openaiCompletion("local llama"));
    const ref: ModelRef = { provider: rt("ollama", m.fetch, { apiKey: null }), model: "qwen3" };
    expect(await generateChatText(ref, { system: "s", prompt: "hi", localText: () => "" })).toBe(
      "local llama",
    );
    expect(m.calls[0]!.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(m.calls[0]!.headers.authorization).toBeUndefined();
  });

  it("structured output: parses JSON returned by the model and validates it", async () => {
    const m = mockFetch(() => openaiCompletion(JSON.stringify({ items: ["a", "b"] })));
    const ref: ModelRef = { provider: rt("openai", m.fetch), model: "gpt-x" };
    const out = await generateStructured(ref, {
      schema: z.object({ items: z.array(z.string()) }),
      name: "items",
      system: "s",
      prompt: "p",
      local: () => ({ items: [] }),
    });
    expect(out.items).toEqual(["a", "b"]);
    const body = JSON.parse(m.calls[0]!.body!);
    expect(JSON.stringify(body.response_format ?? body)).toContain("json");
  });

  it("missing key gives a clear error", async () => {
    const m = mockFetch(() => openaiCompletion("x"));
    const ref: ModelRef = {
      provider: rt("anthropic", m.fetch, { apiKey: null }),
      model: "claude-sonnet-5-5",
    };
    await expect(generateChatText(ref, { system: "s", prompt: "p", localText: () => "" })).rejects.toThrow(
      /API Key/,
    );
    expect(m.calls).toHaveLength(0);
  });
});

describe("embedding adapters", () => {
  it("openai: posts to /embeddings and returns vectors in order", async () => {
    const m = mockFetch((c) => {
      const input = JSON.parse(c.body!).input as string[];
      return json({
        object: "list",
        data: input.map((_, i) => ({ object: "embedding", index: i, embedding: [i, 1, 0] })),
        model: "text-embedding-3-small",
        usage: { prompt_tokens: 1, total_tokens: 1 },
      });
    });
    const ref: ModelRef = { provider: rt("openai", m.fetch), model: "text-embedding-3-small" };
    const out = await embedTexts(ref, ["a", "b", "c"]);
    expect(out).toEqual([
      [0, 1, 0],
      [1, 1, 0],
      [2, 1, 0],
    ]);
    expect(m.calls[0]!.url).toBe("https://api.openai.com/v1/embeddings");
  });

  it("google: uses batchEmbedContents", async () => {
    const m = mockFetch((c) => {
      const reqs = JSON.parse(c.body!).requests as unknown[] | undefined;
      return json({ embeddings: (reqs ?? [1]).map(() => ({ values: [0.5, 0.5] })) });
    });
    const ref: ModelRef = { provider: rt("google", m.fetch), model: "gemini-embedding-2" };
    const out = await embedTexts(ref, ["x", "y"]);
    expect(out).toHaveLength(2);
    expect(m.calls[0]!.url).toContain("gemini-embedding-2:batchEmbedContents");
  });

  it("anthropic has no embedding API", async () => {
    const ref: ModelRef = { provider: rt("anthropic", mockFetch(() => json({})).fetch), model: "x" };
    await expect(embedTexts(ref, ["a"])).rejects.toThrow(/Anthropic 没有 Embedding/);
  });

  it("local: deterministic vectors with dimension from the model name", async () => {
    const ref: ModelRef = { provider: { id: "local", kind: "local" }, model: "hash-384" };
    const [a, b] = await embedTexts(ref, ["图灵", "图灵"]);
    expect(a).toHaveLength(384);
    expect(a).toEqual(b);
  });
});

describe("search adapters", () => {
  it("tavily: POST /search with bearer auth", async () => {
    const m = mockFetch(() =>
      json({ results: [{ title: "T", url: "https://t.example", content: "snippet", raw_content: "full" }] }),
    );
    const out = await webSearch({ provider: rt("tavily", m.fetch), model: "advanced" }, "图灵", {
      withContent: true,
    });
    expect(out).toEqual([{ title: "T", url: "https://t.example", snippet: "snippet", content: "full" }]);
    const c = m.calls[0]!;
    expect(c.url).toBe("https://api.tavily.com/search");
    expect(c.headers.authorization).toBe("Bearer test-key-1234");
    expect(JSON.parse(c.body!)).toMatchObject({
      query: "图灵",
      search_depth: "advanced",
      include_raw_content: true,
    });
  });

  it("brave: GET with subscription token and strips markup", async () => {
    const m = mockFetch(() =>
      json({
        web: {
          results: [{ title: "<strong>B</strong>", url: "https://b.example", description: "d <b>x</b>" }],
        },
      }),
    );
    const out = await webSearch({ provider: rt("brave", m.fetch), model: "web" }, "ai winter");
    expect(out[0]).toEqual({ title: "B", url: "https://b.example", snippet: "d x" });
    expect(m.calls[0]!.url).toBe("https://api.search.brave.com/res/v1/web/search?q=ai%20winter&count=8");
    expect(m.calls[0]!.headers["x-subscription-token"]).toBe("test-key-1234");
  });

  it("searxng: GET /search?format=json on the configured base url", async () => {
    const m = mockFetch(() => json({ results: [{ title: "S", url: "https://s.example", content: "c" }] }));
    const out = await webSearch(
      {
        provider: rt("searxng", m.fetch, { apiKey: null, baseUrl: "http://searx.local:8080/" }),
        model: "general",
      },
      "q",
    );
    expect(out).toEqual([{ title: "S", url: "https://s.example", snippet: "c" }]);
    expect(m.calls[0]!.url).toBe("http://searx.local:8080/search?q=q&format=json&categories=general");
  });
});

describe("speech adapters", () => {
  it("openai tts: posts to /audio/speech and returns audio bytes", async () => {
    const m = mockFetch(
      () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }),
    );
    const out = await synthesizeSpeech(
      { provider: rt("openai", m.fetch), model: "gpt-4o-mini-tts" },
      "你好",
      "nova",
    );
    expect([...out.data]).toEqual([1, 2, 3]);
    expect(out.mediaType).toContain("audio");
    expect(m.calls[0]!.url).toBe("https://api.openai.com/v1/audio/speech");
    expect(JSON.parse(m.calls[0]!.body!)).toMatchObject({
      model: "gpt-4o-mini-tts",
      input: "你好",
      voice: "nova",
    });
  });

  it("elevenlabs tts: posts to /v1/text-to-speech/:voice", async () => {
    const m = mockFetch(
      () => new Response(new Uint8Array([9, 9]), { headers: { "content-type": "audio/mpeg" } }),
    );
    const out = await synthesizeSpeech(
      { provider: rt("elevenlabs", m.fetch), model: "eleven_multilingual_v2" },
      "hello",
      "voice123",
    );
    expect(out.data).toHaveLength(2);
    const c = m.calls[0]!;
    expect(c.url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice123?output_format=mp3_44100_128");
    expect(c.headers["xi-api-key"]).toBe("test-key-1234");
    expect(JSON.parse(c.body!)).toEqual({ text: "hello", model_id: "eleven_multilingual_v2" });
  });

  it("edge-tts gives a clear unsupported error", async () => {
    await expect(
      synthesizeSpeech({ provider: rt("edge-tts", mockFetch(() => json({})).fetch), model: "x" }, "hi"),
    ).rejects.toThrow(/暂不支持/);
  });

  it("openai stt: posts multipart to /audio/transcriptions", async () => {
    const m = mockFetch(() => json({ text: "转写结果", language: "zh", duration: 1.5 }));
    const out = await transcribeAudio(
      { provider: rt("openai", m.fetch), model: "whisper-1" },
      new Uint8Array([0, 1, 2]),
    );
    expect(out.text).toBe("转写结果");
    expect(m.calls[0]!.url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(m.calls[0]!.bodyRaw).toBeInstanceOf(FormData);
  });
});

describe("image adapters", () => {
  const png = new Uint8Array([137, 80, 78, 71]);

  it("openai: /images/generations with b64 response", async () => {
    const m = mockFetch(() =>
      json({ created: 1, data: [{ b64_json: Buffer.from(png).toString("base64") }] }),
    );
    const out = await generateImageFile({ provider: rt("openai", m.fetch), model: "gpt-image-2" }, "a cat");
    expect([...out.data]).toEqual([...png]);
    expect(m.calls[0]!.url).toBe("https://api.openai.com/v1/images/generations");
    expect(JSON.parse(m.calls[0]!.body!)).toMatchObject({ model: "gpt-image-2", prompt: "a cat" });
  });

  it("fal: runs the model path with Key auth, then downloads the image", async () => {
    const m = mockFetch((c) =>
      c.url.startsWith("https://fal.run/")
        ? json({ images: [{ url: "https://cdn.fal.example/img.png" }] })
        : new Response(png, { headers: { "content-type": "image/png" } }),
    );
    const out = await generateImageFile(
      { provider: rt("fal", m.fetch), model: "fal-ai/flux/schnell" },
      "a dog",
    );
    expect(out.mediaType).toBe("image/png");
    expect(m.calls[0]!.url).toBe("https://fal.run/fal-ai/flux/schnell");
    expect(m.calls[0]!.headers.authorization).toBe("Key test-key-1234");
    expect(m.calls[1]!.url).toBe("https://cdn.fal.example/img.png");
  });

  it("replicate: creates a prediction, polls until done, downloads output", async () => {
    let polls = 0;
    const m = mockFetch((c) => {
      if (c.url.endsWith("/predictions"))
        return json({
          id: "p1",
          status: "processing",
          urls: { get: "https://api.replicate.com/v1/predictions/p1" },
        });
      if (c.url.endsWith("/predictions/p1")) {
        polls++;
        return json(
          polls < 2
            ? { status: "processing", urls: { get: "https://api.replicate.com/v1/predictions/p1" } }
            : { status: "succeeded", output: ["https://replicate.delivery/out.webp"] },
        );
      }
      return new Response(png, { headers: { "content-type": "image/webp" } });
    });
    const out = await generateImageFile(
      { provider: rt("replicate", m.fetch), model: "black-forest-labs/flux-schnell" },
      "x",
      { pollMs: 0 },
    );
    expect(out.mediaType).toBe("image/webp");
    expect(m.calls[0]!.url).toBe(
      "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",
    );
    expect(m.calls[0]!.headers.prefer).toBe("wait");
    expect(polls).toBe(2);
  });

  it("comfyui: queues the workflow, reads history and fetches /view", async () => {
    const m = mockFetch((c) => {
      if (c.url.endsWith("/prompt")) return json({ prompt_id: "abc" });
      if (c.url.endsWith("/history/abc"))
        return json({
          abc: { outputs: { "9": { images: [{ filename: "folio_1.png", subfolder: "", type: "output" }] } } },
        });
      return new Response(png, { headers: { "content-type": "image/png" } });
    });
    const out = await generateImageFile(
      { provider: rt("comfyui", m.fetch, { apiKey: null }), model: "sd_xl_base_1.0.safetensors" },
      "mountains",
      { pollMs: 0 },
    );
    expect(out.data).toHaveLength(4);
    const queued = JSON.parse(m.calls[0]!.body!);
    expect(queued.prompt["4"].inputs.ckpt_name).toBe("sd_xl_base_1.0.safetensors");
    expect(queued.prompt["6"].inputs.text).toBe("mountains");
    expect(m.calls[2]!.url).toBe("http://127.0.0.1:8188/view?filename=folio_1.png&subfolder=&type=output");
    expect(Object.keys(comfyWorkflow("a", "b", 1))).toContain("9");
  });
});

describe("connection test & model listing", () => {
  it("openai: lists models and reports latency", async () => {
    const m = mockFetch(() => json({ data: [{ id: "gpt-b" }, { id: "gpt-a" }] }));
    const res = await testConnection(rt("openai", m.fetch));
    expect(res.ok).toBe(true);
    expect(res.models).toEqual(["gpt-a", "gpt-b"]);
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    expect(m.calls[0]!.url).toBe("https://api.openai.com/v1/models");
  });

  it("reports failures without throwing and without leaking the key", async () => {
    const m = mockFetch(() => json({ error: { message: "invalid x-api-key" } }, 401));
    const res = await testConnection(rt("anthropic", m.fetch));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/401/);
    expect(res.error).not.toContain("test-key-1234");
    expect(m.calls[0]!.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("network errors are reported", async () => {
    const res = await testConnection(
      rt("ollama", (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/无法连接|fetch failed/);
  });

  it("google: strips the models/ prefix", async () => {
    const m = mockFetch(() => json({ models: [{ name: "models/gemini-4-argon" }] }));
    expect(await listModels(rt("google", m.fetch))).toEqual(["gemini-4-argon"]);
  });

  it("local: always ok", async () => {
    const res = await testConnection({ id: "local", kind: "local" });
    expect(res.ok).toBe(true);
    expect(res.models).toContain("hash-384");
  });

  it("search providers are tested with a tiny query", async () => {
    const m = mockFetch(() => json({ results: [] }));
    expect((await testConnection(rt("tavily", m.fetch))).ok).toBe(true);
    expect(m.calls[0]!.url).toBe("https://api.tavily.com/search");
  });
});
