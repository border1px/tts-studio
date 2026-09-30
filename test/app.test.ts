import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/index";
import { makeSsml } from "../src/tts/ssml";
import { splitText } from "../src/tts/chunks";
import type { SpeechChunkSynthesizer } from "../src/tts";
import type { Bindings, Fetcher, SpeechOptions } from "../src/types";

const edgeEnv: Bindings = {};
const validSpeech = { input: "你好", voice: "zh-CN-XiaoxiaoNeural", speed: 1, pitch: 0, style: "general" };

function jsonSpeech(body: unknown, headers: Record<string, string> = {}) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

describe("API routes", () => {
  it("returns public configuration without secrets", async () => {
    const response = await createApp().request("/api/config", {}, {
      ...edgeEnv, SILICONFLOW_API_KEY: "secret", APP_ACCESS_KEY: "access-secret",
    });
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.authRequired).toBe(true);
    expect(body.sttServerTokenAvailable).toBe(true);
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("rejects missing input, malformed JSON, unsupported methods and oversized text", async () => {
    const app = createApp();
    const missing = await app.request("/v1/audio/speech", jsonSpeech({}), edgeEnv);
    expect(missing.status).toBe(400);
    expect((await missing.json() as { error: { code: string } }).error.code).toBe("missing_input");
    const empty = await app.request("/v1/audio/speech", jsonSpeech({ input: "" }), edgeEnv);
    expect((await empty.json() as { error: { message: string } }).error.message).toBe("请输入文字");
    const malformed = await app.request("/v1/audio/speech", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
    }, edgeEnv);
    expect(malformed.status).toBe(400);
    expect((await malformed.json() as { error: { code: string } }).error.code).toBe("invalid_json");
    expect((await app.request("/v1/audio/speech", { method: "GET" }, edgeEnv)).status).toBe(405);
    expect((await app.request("/v1/audio/speech", jsonSpeech({ input: "a".repeat(10001) }), edgeEnv)).status).toBe(413);
  });

  it("fails closed when a server key has no access key", async () => {
    const response = await createApp().request("/v1/audio/speech", jsonSpeech(validSpeech), {
      ...edgeEnv, SILICONFLOW_API_KEY: "server-secret",
    });
    expect(response.status).toBe(503);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("access_key_not_configured");
    expect((await createApp().request("/api/config", {}, { SILICONFLOW_API_KEY: "server-secret" })).status).toBe(503);
  });

  it("requires the configured access key", async () => {
    const env = { ...edgeEnv, APP_ACCESS_KEY: "access-secret" };
    const response = await createApp().request("/v1/audio/speech", jsonSpeech(validSpeech, { "X-API-Key": "wrong" }), env);
    expect(response.status).toBe(401);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("unauthorized");
  });

  it("rejects a blank access key configuration", async () => {
    const response = await createApp().request("/api/config", {}, { APP_ACCESS_KEY: "   " });
    expect(response.status).toBe(503);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("invalid_access_key");
  });

  it("allows CORS preflight without an access key", async () => {
    const response = await createApp().request("/v1/audio/speech", {
      method: "OPTIONS",
      headers: { Origin: "https://example.com", "Access-Control-Request-Method": "POST" },
    }, { ...edgeEnv, APP_ACCESS_KEY: "access-secret" });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("speech synthesis", () => {
  it("rejects non-numeric speech controls", async () => {
    const response = await createApp().request("/v1/audio/speech", jsonSpeech({ ...validSpeech, speed: true }), edgeEnv);
    expect(response.status).toBe(400);
    expect((await response.json() as { error: { code: string; param: string } }).error).toMatchObject({
      code: "invalid_parameter", param: "speed",
    });
  });

  it("escapes SSML and preserves punctuation while splitting", () => {
    const options: SpeechOptions = { input: "", voice: "zh-CN-XiaoxiaoNeural", speed: 1, pitch: 0, volume: 0, style: "general" };
    expect(makeSsml("A&B <test> \"hi\"", options)).toContain("A&amp;B &lt;test&gt; &quot;hi&quot;");
    const text = "你好。".repeat(600);
    const chunks = splitText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => Array.from(chunk).length <= 1500)).toBe(true);
    expect(chunks.join("")).toBe(text);
  });

  it("reuses the Edge token and joins generated chunks", async () => {
    const jwt = `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`;
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/apps/endpoint")) return Response.json({ r: "eastus", t: jwt });
      expect(init?.headers).toMatchObject({ Authorization: jwt });
      return new Response(new Uint8Array([calls.length]));
    }) as unknown as Fetcher;
    const response = await createApp({ fetcher }).request("/v1/audio/speech", jsonSpeech({ ...validSpeech, input: "你".repeat(1600) }), edgeEnv);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([2, 3]);
    expect(calls.filter((url) => url.includes("/apps/endpoint"))).toHaveLength(1);
  });

  it("accepts TXT multipart uploads with the same speech parameters", async () => {
    const synthesizer: SpeechChunkSynthesizer = {
      synthesize: vi.fn(async (text: string, options: SpeechOptions) => {
        expect(text).toBe("Hello TXT");
        expect(options.speed).toBe(1.25);
        return new Uint8Array([4, 5]);
      }),
    };
    const form = new FormData();
    form.append("file", new File(["Hello TXT"], "sample.txt", { type: "text/plain" }));
    form.append("speed", "1.25");
    const response = await createApp({ synthesizer }).request("/v1/audio/speech", {
      method: "POST", body: form,
    }, edgeEnv);
    expect(response.status).toBe(200);
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([4, 5]);
  });
});

describe("transcription", () => {
  function audioRequest(token?: string) {
    const form = new FormData();
    form.append("file", new File(["audio"], "sample.mp3", { type: "audio/mpeg" }));
    if (token) form.append("token", token);
    return { method: "POST", body: form };
  }

  it("requires a token when no server token exists", async () => {
    const response = await createApp().request("/v1/audio/transcriptions", audioRequest(), edgeEnv);
    expect(response.status).toBe(503);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("stt_token_missing");
  });

  it("prefers a caller token over the server token", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer caller-token" });
      expect((init?.body as FormData).get("model")).toBe("FunAudioLLM/SenseVoiceSmall");
      return Response.json({ text: "转录文字" });
    }) as unknown as Fetcher;
    const env = { ...edgeEnv, SILICONFLOW_API_KEY: "server-token", APP_ACCESS_KEY: "access-secret" };
    const response = await createApp({ fetcher }).request("/v1/audio/transcriptions", {
      ...audioRequest("caller-token"),
      headers: { "X-API-Key": "access-secret" },
    }, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "转录文字" });
  });

  it("uses the server token when the caller omits one", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer server-token" });
      return Response.json({ text: "server text" });
    }) as unknown as Fetcher;
    const env = { ...edgeEnv, SILICONFLOW_API_KEY: "server-token", APP_ACCESS_KEY: "access-secret" };
    const response = await createApp({ fetcher }).request("/v1/audio/transcriptions", {
      ...audioRequest(), headers: { "X-API-Key": "access-secret" },
    }, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "server text" });
  });

  it("validates the audio extension", async () => {
    const form = new FormData();
    form.append("file", new File(["audio"], "sample.exe"));
    const response = await createApp().request("/v1/audio/transcriptions", { method: "POST", body: form }, edgeEnv);
    expect(response.status).toBe(400);
  });
});
