import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHAT_MODEL,
  isChatCapableProviderType,
  isProviderTypeChangeCompatibleWithTranscription,
  isTranscriptionCapableProviderType,
} from "@/lib/ai-providers";
import { InstanceSetting_AIProviderType } from "@/types/proto/api/v1/instance_service_pb";

describe("AI provider capabilities", () => {
  it("uses GLM Flash as the default chat model", () => {
    expect(DEFAULT_CHAT_MODEL).toBe("z-ai/glm-5.3-flash");
  });

  it("matches the server chat implementations", () => {
    expect(isChatCapableProviderType(InstanceSetting_AIProviderType.OPENAI)).toBe(true);
    expect(isChatCapableProviderType(InstanceSetting_AIProviderType.OPENROUTER)).toBe(true);
    expect(isChatCapableProviderType(InstanceSetting_AIProviderType.DEEPINFRA)).toBe(true);
    expect(isChatCapableProviderType(InstanceSetting_AIProviderType.GEMINI)).toBe(false);
  });

  it("only offers providers implemented by transcription", () => {
    expect(isTranscriptionCapableProviderType(InstanceSetting_AIProviderType.OPENAI)).toBe(true);
    expect(isTranscriptionCapableProviderType(InstanceSetting_AIProviderType.GEMINI)).toBe(true);
    expect(isTranscriptionCapableProviderType(InstanceSetting_AIProviderType.OPENROUTER)).toBe(false);
    expect(isTranscriptionCapableProviderType(InstanceSetting_AIProviderType.DEEPINFRA)).toBe(false);
  });

  it("blocks changing a provider referenced by transcription to a chat-only type", () => {
    expect(isProviderTypeChangeCompatibleWithTranscription("provider-1", InstanceSetting_AIProviderType.OPENROUTER, "provider-1")).toBe(
      false,
    );
  });
});
