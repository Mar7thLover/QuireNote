import { generateSpeech, transcribe } from "ai";
import { PROVIDER_CATALOG } from "./catalog";
import { requestBytes } from "./http";
import { aiText } from "./messages";
import { baseUrlOf, errorMessage, requireKey, speechModel, transcriptionModel } from "./sdk";
import { AiError, type BinaryResult, type ModelRef, UnsupportedError } from "./types";

export function defaultVoices(ref: ModelRef): { A: string; B: string } {
  const v = PROVIDER_CATALOG[ref.provider.kind].voices;
  return { A: v?.A ?? "alloy", B: v?.B ?? "nova" };
}

/** 文本转语音。返回音频字节与 MIME（mp3 优先）。 */
export async function synthesizeSpeech(ref: ModelRef, text: string, voice?: string): Promise<BinaryResult> {
  const p = ref.provider;
  switch (p.kind) {
    case "openai":
    case "openai-compatible":
    case "google": {
      try {
        const res = await generateSpeech({
          model: speechModel(p, ref.model),
          text,
          voice: voice ?? defaultVoices(ref).A,
          ...(p.kind === "google" ? {} : { outputFormat: "mp3" }),
          maxRetries: 1,
        });
        return { data: res.audio.uint8Array, mediaType: res.audio.mediaType };
      } catch (err) {
        throw new AiError(aiText().ttsFailed(errorMessage(err)));
      }
    }
    case "elevenlabs": {
      const v = voice ?? defaultVoices(ref).A;
      const url = `${baseUrlOf(p)}/v1/text-to-speech/${encodeURIComponent(v)}?output_format=mp3_44100_128`;
      const res = await requestBytes(p, url, {
        method: "POST",
        headers: { "content-type": "application/json", "xi-api-key": requireKey(p), accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: ref.model }),
      });
      return { data: res.data, mediaType: res.mediaType.startsWith("audio/") ? res.mediaType : "audio/mpeg" };
    }
    case "edge-tts":
      throw new UnsupportedError(aiText().edgeTts());
    default:
      throw new UnsupportedError(aiText().noTts(p.kind));
  }
}

export interface TranscriptResult {
  text: string;
  segments: { text: string; start: number; end: number }[];
  language?: string;
}

/** 语音转写（OpenAI Whisper / gpt-4o-transcribe、OpenAI 兼容接口、Gemini transcribe）。 */
export async function transcribeAudio(ref: ModelRef, audio: Uint8Array): Promise<TranscriptResult> {
  const p = ref.provider;
  if (p.kind !== "openai" && p.kind !== "openai-compatible" && p.kind !== "google") {
    throw new UnsupportedError(aiText().noSttHint(p.kind));
  }
  try {
    const res = await transcribe({ model: transcriptionModel(p, ref.model), audio, maxRetries: 1 });
    return {
      text: res.text,
      segments: res.segments.map((s) => ({ text: s.text, start: s.startSecond, end: s.endSecond })),
      ...(res.language ? { language: res.language } : {}),
    };
  } catch (err) {
    throw new AiError(aiText().sttFailed(errorMessage(err)));
  }
}
