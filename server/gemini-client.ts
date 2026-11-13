import type { GoogleGenAI } from "@google/genai";
import { hasRealValue } from "./ceo-doctor-cli";

export async function getGeminiClient(): Promise<GoogleGenAI> {
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (!hasRealValue(apiKey)) {
    throw new Error("AI_INTEGRATIONS_GEMINI_API_KEY is not configured");
  }

  const { GoogleGenAI } = await import("@google/genai");
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      apiVersion: "",
      baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
    },
  });
}

export function getGeminiChatModel(options: { hasImage?: boolean } = {}): string {
  const explicitModel = process.env.BLACKOPS_GEMINI_CHAT_MODEL || process.env.AI_INTEGRATIONS_GEMINI_MODEL;
  if (hasRealValue(explicitModel)) return explicitModel;
  return options.hasImage ? "gemini-2.5-flash" : "gemini-2.5-flash-lite";
}
