import OpenAI from "openai";
import { hasRealValue } from "./ceo-doctor-cli";

let openaiClient: OpenAI | null = null;

export const OPENAI_ASSISTANT_MODEL = process.env.OPENAI_ASSISTANT_MODEL || "gpt-5.4-nano";
export const OPENAI_TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe";

export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!hasRealValue(apiKey)) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }

  return openaiClient;
}
