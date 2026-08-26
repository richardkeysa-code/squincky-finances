import { createOpenAI } from "@ai-sdk/openai";

export function createOpenAiProvider(apiKey: string) {
  return createOpenAI({ apiKey });
}
