const $ = (id) => document.getElementById(id);
const styleNames = {
  general: "通用", assistant: "助手", chat: "聊天", customerservice: "客服", newscast: "新闻",
  affectionate: "亲切", calm: "平静", cheerful: "愉快", gentle: "温柔", lyrical: "抒情", serious: "严肃",
};
let config;
let audioUrl;

function setStatus(id, message, error = false) {
  const element = $(id);
  element.textContent = message;
  element.classList.toggle("error", error);
}

function renderOptions() {
  if (!config) return;
  const selectedVoice = $("voice").value || config.defaultVoice;
  const selectedStyle = $("style").value || "general";
  $("voice").replaceChildren(...config.voices.map((voice) => {
    const option = document.createElement("option");
    option.value = voice.id;
    option.textContent = `${voice.name} · ${voice.gender === "female" ? "女声" : "男声"}`;
    return option;
  }));
  $("voice").value = selectedVoice;
  $("style").replaceChildren(...config.styles.map((style) => {
    const option = document.createElement("option");
    option.value = style;
    option.textContent = styleNames[style] || style;
    return option;
  }));
  $("style").value = selectedStyle;
  $("tokenHint").textContent = config.sttServerTokenAvailable
    ? "已配置服务端 Token；此处可留空，也可使用自己的 Token。"
    : "部署者未配置 Token，请输入自己的 Token。";
  updateTextCount();
}

function updateTextCount() {
  if (config) $("textCount").textContent = `${Array.from($("text").value).length} / ${config.limits.textCharacters}`;
}

function selectMode(mode) {
  const tts = mode === "tts";
  $("ttsPanel").hidden = !tts;
  $("sttPanel").hidden = tts;
  $("edgeNotice").hidden = !tts;
  $("ttsTab").classList.toggle("active", tts);
  $("sttTab").classList.toggle("active", !tts);
  $("ttsTab").setAttribute("aria-selected", String(tts));
  $("sttTab").setAttribute("aria-selected", String(!tts));
}

function selectSource() {
  const file = document.querySelector('input[name="source"]:checked').value === "file";
  $("textSource").hidden = file;
  $("fileSource").hidden = !file;
}

function requestHeaders(json = false) {
  const headers = new Headers();
  if (json) headers.set("Content-Type", "application/json");
  const key = $("accessKey").value.trim();
  if (key) headers.set("X-API-Key", key);
  return headers;
}

async function responseError(response) {
  try {
    const body = await response.json();
    if (body?.error?.message) return body.error.message;
  } catch {
    // Cloudflare 也可能返回非 JSON 错误页。
  }
  return `请求失败（${response.status}）`;
}

async function submitSpeech(event) {
  event.preventDefault();
  if (!config) return;
  const usingFile = document.querySelector('input[name="source"]:checked').value === "file";
  const parameters = {
    voice: $("voice").value,
    speed: Number($("speed").value),
    pitch: Number($("pitch").value),
    style: $("style").value,
  };
  let body;
  let headers;
  if (usingFile) {
    const file = $("txtFile").files[0];
    if (!file) return setStatus("ttsStatus", "请选择 TXT 文件。", true);
    if (file.size > config.limits.textFileBytes) return setStatus("ttsStatus", "文件超过大小限制。", true);
    body = new FormData();
    body.append("file", file);
    for (const [name, value] of Object.entries(parameters)) body.append(name, String(value));
    headers = requestHeaders();
  } else {
    const input = $("text").value;
    if (!input.trim()) return setStatus("ttsStatus", "请输入文字。", true);
    if (Array.from(input.trim()).length > config.limits.textCharacters) return setStatus("ttsStatus", "文字超过长度限制。", true);
    body = JSON.stringify({ input, ...parameters });
    headers = requestHeaders(true);
  }

  $("ttsSubmit").disabled = true;
  $("ttsResult").hidden = true;
  setStatus("ttsStatus", "正在生成语音…");
  try {
    const response = await fetch("/v1/audio/speech", { method: "POST", headers, body });
    if (!response.ok) throw new Error(await responseError(response));
    const blob = await response.blob();
    // 新音频替换旧音频时释放对象 URL，避免多次生成后占用浏览器内存。
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(blob);
    $("audio").src = audioUrl;
    $("download").href = audioUrl;
    $("ttsResult").hidden = false;
    setStatus("ttsStatus", "语音已生成，可以播放或下载。");
  } catch (error) {
    setStatus("ttsStatus", error.message || "请求失败。", true);
  } finally {
    $("ttsSubmit").disabled = false;
  }
}

async function submitTranscription(event) {
  event.preventDefault();
  if (!config) return;
  const file = $("audioFile").files[0];
  if (!file) return setStatus("sttStatus", "请选择音频文件。", true);
  if (file.size > config.limits.audioFileBytes) return setStatus("sttStatus", "文件超过大小限制。", true);
  const token = $("sttToken").value.trim();
  if (!token && !config.sttServerTokenAvailable) return setStatus("sttStatus", "请输入硅基流动 Token。", true);
  const form = new FormData();
  form.append("file", file);
  if (token) form.append("token", token);
  $("sttSubmit").disabled = true;
  $("sttResult").hidden = true;
  setStatus("sttStatus", "正在转录…");
  try {
    const response = await fetch("/v1/audio/transcriptions", { method: "POST", headers: requestHeaders(), body: form });
    if (!response.ok) throw new Error(await responseError(response));
    const result = await response.json();
    $("transcription").value = result.text || "";
    $("sttResult").hidden = false;
    setStatus("sttStatus", "转录完成。");
  } catch (error) {
    setStatus("sttStatus", error.message || "请求失败。", true);
  } finally {
    $("sttSubmit").disabled = false;
  }
}

$("ttsTab").addEventListener("click", () => selectMode("tts"));
$("sttTab").addEventListener("click", () => selectMode("stt"));
for (const radio of document.querySelectorAll('input[name="source"]')) radio.addEventListener("change", selectSource);
$("text").addEventListener("input", updateTextCount);
$("ttsForm").addEventListener("submit", submitSpeech);
$("sttForm").addEventListener("submit", submitTranscription);
$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("transcription").value);
    setStatus("sttStatus", "已复制。");
  } catch {
    $("transcription").select();
  }
});
$("useForTts").addEventListener("click", () => {
  $("text").value = $("transcription").value;
  document.querySelector('input[name="source"][value="text"]').checked = true;
  selectSource();
  selectMode("tts");
  updateTextCount();
  $("text").focus();
});
window.addEventListener("beforeunload", () => { if (audioUrl) URL.revokeObjectURL(audioUrl); });

$("ttsSubmit").disabled = true;
$("sttSubmit").disabled = true;
try {
  const response = await fetch("/api/config");
  if (!response.ok) throw new Error();
  config = await response.json();
  $("accessSection").hidden = !config.authRequired;
  renderOptions();
  $("ttsSubmit").disabled = false;
  $("sttSubmit").disabled = false;
} catch {
  setStatus("ttsStatus", "无法读取服务配置，请刷新页面。", true);
  setStatus("sttStatus", "无法读取服务配置，请刷新页面。", true);
}
