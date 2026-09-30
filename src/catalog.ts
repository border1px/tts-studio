export const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";

export const VOICES = [
  { id: "zh-CN-XiaoxiaoNeural", name: "晓晓", gender: "female" },
  { id: "zh-CN-YunxiNeural", name: "云希", gender: "male" },
  { id: "zh-CN-YunyangNeural", name: "云扬", gender: "male" },
  { id: "zh-CN-XiaoyiNeural", name: "晓伊", gender: "female" },
  { id: "zh-CN-YunjianNeural", name: "云健", gender: "male" },
  { id: "zh-CN-XiaochenNeural", name: "晓辰", gender: "female" },
  { id: "zh-CN-XiaohanNeural", name: "晓涵", gender: "female" },
  { id: "zh-CN-XiaomengNeural", name: "晓梦", gender: "female" },
  { id: "zh-CN-XiaomoNeural", name: "晓墨", gender: "female" },
  { id: "zh-CN-XiaoqiuNeural", name: "晓秋", gender: "female" },
  { id: "zh-CN-XiaoruiNeural", name: "晓睿", gender: "female" },
  { id: "zh-CN-XiaoshuangNeural", name: "晓双", gender: "female" },
  { id: "zh-CN-XiaoxuanNeural", name: "晓萱", gender: "female" },
  { id: "zh-CN-XiaoyanNeural", name: "晓颜", gender: "female" },
  { id: "zh-CN-XiaoyouNeural", name: "晓悠", gender: "female" },
  { id: "zh-CN-XiaozhenNeural", name: "晓甄", gender: "female" },
  { id: "zh-CN-YunfengNeural", name: "云枫", gender: "male" },
  { id: "zh-CN-YunhaoNeural", name: "云皓", gender: "male" },
  { id: "zh-CN-YunxiaNeural", name: "云夏", gender: "male" },
  { id: "zh-CN-YunyeNeural", name: "云野", gender: "male" },
  { id: "zh-CN-YunzeNeural", name: "云泽", gender: "male" },
] as const;

export const STYLES = [
  "general",
  "assistant",
  "chat",
  "customerservice",
  "newscast",
  "affectionate",
  "calm",
  "cheerful",
  "gentle",
  "lyrical",
  "serious",
] as const;

export const MAX_TEXT_CHARACTERS = 10_000;
export const MAX_TEXT_FILE_BYTES = 500 * 1024;
export const MAX_AUDIO_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_CHUNK_CHARACTERS = 1_500;
