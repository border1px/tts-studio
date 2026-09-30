# Edge TTS 实现原理

这份文档解释本项目的 `src/tts/` 实现，供维护代码时阅读；它不是微软发布的协议规范。代码使用 Edge 兼容客户端链路，不配置 Azure Speech 订阅密钥。**这不等于破解 Azure 鉴权，也不意味着绕过微软的用量、风控或使用条款限制。** 上游协议没有作为稳定的服务端 API 对本项目作出承诺，随时可能调整。

## 与官方接口的区别

微软公开的 [Azure Speech TTS REST 文档](https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech)要求 Speech 资源，并以订阅密钥或相应的访问令牌鉴权。本项目没有调用 Azure 的 `issueToken` 接口，而是模拟 Edge 兼容客户端向另一个 endpoint 服务申请短期令牌，再用该令牌调用地区语音服务。两条链路的合成请求都涉及 SSML 和 `cognitiveservices/v1`，但**令牌来源不同，不应把本项目称为官方 Azure API 的免费配额**。

| 阶段 | 本项目的做法 | 代码位置 |
| --- | --- | --- |
| 输入处理 | 校验文本、声音和参数；长文本按最多 1,500 个 Unicode 码点分段，尽量在句末断开 | `src/validation.ts`、`src/tts/chunks.ts` |
| 申请令牌 | 对客户端 endpoint 请求生成 HMAC-SHA256 签名，提交空 POST，读取响应中的地区 `r` 和令牌 `t` | `src/tts/edge.ts` 的 `signEndpointRequest`、`requestEndpoint` |
| 合成语音 | 将当前片段、声音、语速、音调等转换为 SSML；使用 `t` 请求 `https://{r}.tts.speech.microsoft.com/cognitiveservices/v1` | `src/tts/ssml.ts`、`src/tts/edge.ts` 的 `synthesize` |
| 汇总结果 | 顺序合成各段，按字节顺序拼接 MP3，作为 `audio/mpeg` 返回 | `src/tts/index.ts`、`src/tts/chunks.ts` |

## 令牌请求为什么这样写

`ENDPOINT_URL` 指向兼容客户端使用的 endpoint 服务。代码从 URL 去掉 `https://`，编码剩余地址，再与客户端标识、UTC 时间和随机请求 ID 按固定顺序拼接、转小写。随后用固定的客户端签名材料计算 HMAC-SHA256，形成 `X-MT-Signature` 请求头。`X-ClientVersion`、`X-UserId` 等请求头也属于这一兼容协议的客户端标识。

签名格式可以概括为下面的伪代码（`key` 是代码中的兼容客户端固定材料，不是 Azure 订阅密钥）：

```text
path = encodeURIComponent(ENDPOINT_URL 去掉 "https://" 后的部分)
message = lower("MSTranslatorAndroidApp" + path + utcDate + requestId)
signature = Base64(HMAC-SHA256(key, message))
X-MT-Signature = "MSTranslatorAndroidApp::" + signature + "::" + utcDate + "::" + requestId
```

签名材料是打包在客户端协议中的固定值，**不是部署者的 Azure Key，也不应被当作本项目的安全边界**。任何签名格式、标识或上游验收规则发生变化，都可能导致取令牌失败；不应通过增加请求频率来“修复”这种失败。

响应中的 `r` 是地区标签，代码只允许由小写字母、数字和连字符组成的值，避免它被拼接成任意目标主机。`t` 是上游返回的短期令牌。代码只解码 JWT 的 `exp` 字段用于决定本地缓存何时刷新，**不验证 JWT 签名，也不使用其内容给本项目用户授权**；实际令牌有效性由上游合成服务判断。当前 Worker 实例会在令牌过期前 3 分钟刷新，并通过一个共享的 `pending` Promise 合并并发取令牌请求。

## 合成与失败处理

每一段文本都被转义为 XML 文本，放入 SSML 的 `<voice>`、`<prosody>` 中；非通用风格再包裹 `mstts:express-as`。语速、音调、音量只是给上游的合成参数，具体声音不一定支持全部风格。合成请求的 `Authorization` 头直接携带本链路取得的 `t`，不加官方 Bearer 流程的前缀。项目固定请求 `audio-24khz-48kbitrate-mono-mp3`，首版仅返回 MP3。微软的 [SSML 文档](https://learn.microsoft.com/azure/ai-services/speech-service/speech-synthesis-markup)可用于理解这些标签，但不构成本项目兼容链路的稳定性保证。

取得令牌后，单段合成最多尝试 3 次：网络错误会短暂退避；`401` 会清除本地令牌缓存，下次重新申请；`429` 和 `5xx` 也会短暂退避；其他上游状态直接作为错误返回。取令牌阶段失败则直接返回错误，不进入这组重试。这里的重试是为了应对偶发故障，**不会解除上游限流**。多段 MP3 只是简单拼接，没有重新编码，也不保证段间完全无停顿。

## 运行边界

- 代码不依赖 Azure Speech Key，但部署者仍需自行确认服务使用条件；不能承诺永久可用、无限制或官方支持。
- 公开部署会消耗 Cloudflare Worker 的请求与流量额度。`APP_ACCESS_KEY` 保护的是**本项目的 API**，与上游令牌无关；公开运营时还应考虑限流。
- 出现 `edge_endpoint_unavailable` 时，先检查取令牌阶段；出现 `edge_upstream_error` 时，检查令牌是否过期、合成响应状态及上游是否调整协议。不要把这些错误直接暴露成原始上游响应正文。
