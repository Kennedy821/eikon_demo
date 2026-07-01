import { NextRequest, NextResponse } from "next/server";
import { callBackend, BackendError } from "@/lib/server/backend";

export type VoiceName = "Peach" | "Heart" | "Fable";

const VOICE_CONFIG: Record<VoiceName, { backend: "tts" | "kokoroTts"; kokoroVoice?: string }> = {
  Peach: { backend: "tts" },
  Heart: { backend: "kokoroTts", kokoroVoice: "af_heart" },
  Fable: { backend: "kokoroTts", kokoroVoice: "bm_fable" },
};

/**
 * POST /api/eikon/tts
 *   { text, voice? }  ->  { audioBase64, format }
 *
 * Routes to Piper (Peach) or Kokoro/Gilgamesh (Heart, Fable) depending on voice.
 * Defaults to Heart.
 */
export async function POST(req: NextRequest) {
  try {
    const { text, voice = "Heart" } = (await req.json()) as {
      text?: string;
      voice?: VoiceName;
    };

    if (!text || text.trim().length < 2) {
      return NextResponse.json({ error: "text required (min 2 chars)" }, { status: 400 });
    }

    const config = VOICE_CONFIG[voice] ?? VOICE_CONFIG.Heart;
    const json: Record<string, unknown> = { text };
    if (config.kokoroVoice) {
      json.voice = config.kokoroVoice;
      json.speed = 0.8;
    }

    const data = await callBackend<{ audio_base64?: string; format?: string }>(config.backend, {
      json,
      timeoutMs: 60_000,
    });

    if (!data?.audio_base64) {
      return NextResponse.json({ error: "No audio returned from TTS server" }, { status: 502 });
    }

    return NextResponse.json({ audioBase64: data.audio_base64, format: data.format ?? "wav" });
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "TTS failed" },
      { status },
    );
  }
}
