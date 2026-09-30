export interface Bindings {
  SILICONFLOW_API_KEY?: string;
  APP_ACCESS_KEY?: string;
}

export interface SpeechOptions {
  input: string;
  voice: string;
  speed: number;
  pitch: number;
  volume: number;
  style: string;
}

export type Fetcher = typeof fetch;
