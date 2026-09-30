import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRequired, assertSecretsProtected } from "./config";
import { DEFAULT_VOICE, MAX_AUDIO_FILE_BYTES, MAX_TEXT_CHARACTERS, MAX_TEXT_FILE_BYTES, STYLES, VOICES } from "./catalog";
import { ApiError, errorBody } from "./errors";
import { transcribe } from "./stt";
import { EdgeTts } from "./tts/edge";
import { synthesizeSpeech, type SpeechChunkSynthesizer } from "./tts";
import type { Bindings, Fetcher } from "./types";
import { parseSpeechRequest, parseTranscriptionRequest } from "./validation";

async function matchingKeys(actual: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(actualHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

interface AppDependencies {
  fetcher?: Fetcher;
  synthesizer?: SpeechChunkSynthesizer;
}

export function createApp(dependencies: AppDependencies = {}) {
  const fetcher = dependencies.fetcher ?? ((input, init) => fetch(input, init));
  const synthesizer = dependencies.synthesizer ?? new EdgeTts(fetcher);
  const app = new Hono<{ Bindings: Bindings }>();
  const apiCors = cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "X-API-Key"],
    maxAge: 86400,
  });
  app.use("/api/*", apiCors);
  app.use("/v1/*", apiCors);

  app.get("/api/config", (c) => {
    assertSecretsProtected(c.env);
    return c.json({
      authRequired: authRequired(c.env),
      sttServerTokenAvailable: Boolean(c.env.SILICONFLOW_API_KEY),
      defaultVoice: DEFAULT_VOICE,
      voices: VOICES,
      styles: STYLES,
      limits: {
        textCharacters: MAX_TEXT_CHARACTERS,
        textFileBytes: MAX_TEXT_FILE_BYTES,
        audioFileBytes: MAX_AUDIO_FILE_BYTES,
      },
    });
  });

  app.use("/v1/*", async (c, next) => {
    assertSecretsProtected(c.env);
    if (c.env.APP_ACCESS_KEY && !(await matchingKeys(c.req.header("X-API-Key") || "", c.env.APP_ACCESS_KEY))) {
      throw new ApiError(401, "unauthorized", "X-API-Key 缺失或错误", "X-API-Key", "authentication_error");
    }
    await next();
  });

  app.post("/v1/audio/speech", async (c) => {
    const options = await parseSpeechRequest(c.req.raw);
    const audio = await synthesizeSpeech(options, synthesizer);
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  });

  app.post("/v1/audio/transcriptions", async (c) => {
    const { file, token: suppliedToken } = await parseTranscriptionRequest(c.req.raw);
    const token = suppliedToken || c.env.SILICONFLOW_API_KEY;
    if (!token) throw new ApiError(503, "stt_token_missing", "请提供 token 或配置 SILICONFLOW_API_KEY");
    return c.json({ text: await transcribe(file, token, fetcher) });
  });

  for (const path of ["/v1/audio/speech", "/v1/audio/transcriptions"]) {
    app.all(path, () => {
      throw new ApiError(405, "method_not_allowed", "此接口仅支持 POST 请求", "method");
    });
  }

  app.notFound(() => new Response(JSON.stringify(errorBody(new ApiError(404, "not_found", "接口不存在"))), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  }));

  app.onError((error) => {
    if (!(error instanceof ApiError)) console.error("Unhandled request error", error);
    const known = error instanceof ApiError ? error : new ApiError(500, "internal_error", "服务器内部错误");
    return new Response(JSON.stringify(errorBody(known)), {
      status: known.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  return app;
}

export default createApp();
