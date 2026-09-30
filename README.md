# Cloudflare Workers 语音工作台

一个简单的文字转语音（TTS）与语音转文字（STT）服务：Cloudflare Workers 提供 API，Workers Static Assets 提供网页。后端使用 TypeScript + Hono；网页是独立的 HTML、CSS 和原生 JavaScript 文件。

部署后的 `/docs` 是可直接访问的 API 文档，包含请求参数和 `curl` 示例；网页也提供入口。

在线体验：[语音工作台](https://tts-studio.hicjiajia.workers.dev) · [API 文档](https://tts-studio.hicjiajia.workers.dev/docs)

项目特点：默认无需 Azure 密钥即可使用 Edge TTS；网页提供 21 种中文声音、文字/TXT 转 MP3，以及适配桌面和手机的界面。另提供 TTS/STT API；STT 需要硅基流动 Token。接口路径与 OpenAI 语音接口相似，但并非完整兼容，也不承诺无限制或永久免费的上游服务。

## 部署

公开仓库可使用一键部署按钮，将项目部署到自己的 Cloudflare 账号：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/border1px/tts-studio)

也可以从本地通过 Wrangler 部署到 Cloudflare Workers：

```sh
npm install
npx wrangler login
npm run deploy
```

TTS 仅使用 Edge 兼容协议，不需要设置密钥。STT 使用者在网页输入自己的硅基流动 Token，或在 API 请求中提交 `token`。部署时会一并上传 Worker 和 `public/` 静态资源。从本地部署后，后续代码更新需要重新运行 `npm run deploy`；推送 GitHub 本身不会自动触发部署。

本地开发：

```sh
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

打开 Wrangler 输出的本地地址。`npm run typecheck` 和 `npm test` 分别执行类型检查与测试。

## 可选配置

公开仓库和 `wrangler.jsonc` 中不要放真实密钥。线上使用 `npx wrangler secret put NAME` 设置 Secret；本地写在已忽略的 `.dev.vars` 中。

| 名称 | 用途 |
| --- | --- |
| `SILICONFLOW_API_KEY` | 部署者提供的默认 STT Token，可不配置 |
| `APP_ACCESS_KEY` | 保护两个处理接口的访问密钥；配置服务端 STT Token 时必填 |

配置 STT 默认 Token 时必须同时设置 `APP_ACCESS_KEY`。也可以只配置 `APP_ACCESS_KEY`，以保护 Edge TTS 和由调用者自带 Token 的 STT 接口。

网页会在需要时显示访问密钥输入框；密钥只保留在当前页面内存，不写入浏览器存储。调用者提供的 STT Token 优先于服务端默认 Token。错误配置会使处理接口返回 `503`，避免未经保护地使用服务端凭据。

## API

### 文字转语音

`POST /v1/audio/speech`，返回 `audio/mpeg`（MP3）。JSON 参数：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `input` | 必填 | 要朗读的文本，最多 10,000 字符 |
| `voice` | `zh-CN-XiaoxiaoNeural` | Microsoft Neural 声音名称；网页提供 21 个中文声音 |
| `speed` | `1` | 0.5–2 |
| `pitch` | `0` | -50–50 Hz |
| `volume` | `0` | -1–1，对应 -100%–+100% |
| `style` | `general` | `GET /api/config` 返回可选值；具体声音未必支持所有风格 |

```sh
curl -X POST 'https://YOUR_WORKER.workers.dev/v1/audio/speech' \
  -H 'Content-Type: application/json' \
  -d '{"input":"你好，世界","voice":"zh-CN-XiaoxiaoNeural"}' \
  --output speech.mp3
```

也支持 `multipart/form-data`，以 `file` 字段上传 UTF-8 TXT（最大 500 KB），并以表单字段传入可选语音参数。文本长度同样最多 10,000 字符。

### 语音转文字

`POST /v1/audio/transcriptions`，接收 `multipart/form-data` 的 `file`（最大 10 MB；扩展名为 mp3、wav、m4a、flac、aac、ogg、webm、amr 或 3gp）和可选 `token`，返回 `{ "text": "..." }`。

```sh
curl -X POST 'https://YOUR_WORKER.workers.dev/v1/audio/transcriptions' \
  -F 'file=@audio.mp3' \
  -F 'token=YOUR_SILICONFLOW_TOKEN'
```

若配置了 `APP_ACCESS_KEY`，在上述请求额外加入 `-H 'X-API-Key: YOUR_ACCESS_KEY'`。`GET /api/config` 公开返回声音列表、界面所需状态和大小限制，不返回任何密钥。错误响应为 `{ "error": { "message", "type", "param", "code" } }`。

## 说明

- Edge TTS 依赖非公开的上游协议，可能随 Microsoft 服务变化而失效。
- TTS 只输出 MP3；多种音频格式指 STT 可接受的输入文件，不代表多格式 TTS 输出。
- 服务不保存输入文本、上传音频或生成结果。首版使用访问密钥和输入大小限制控制使用范围；若公开运营，请在 Cloudflare 侧另设限流规则。
