import { GoogleGenAI } from '@google/genai';

const DEFAULT_MODEL = 'gemini-3-flash-preview';

export function getGeminiModel() {
  return (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

export function getGeminiClient() {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  return new GoogleGenAI({ apiKey: key });
}

/** Claude {user,assistant} → Gemini {user,model} */
export function toGeminiContents(messages) {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
}

function resolveThinkingLevel() {
  const raw = (process.env.GEMINI_THINKING_LEVEL || 'low').toLowerCase();
  if (raw === 'high') return 'HIGH';
  if (raw === 'medium') return 'MEDIUM';
  return 'LOW';
}

export function buildGeminiConfig(system) {
  const config = {
    maxOutputTokens: 16384,
    thinkingConfig: { thinkingLevel: resolveThinkingLevel() },
  };
  if (system?.trim()) config.systemInstruction = system.trim();
  return config;
}

function extractUsage(response, messages, system, text) {
  const meta = response?.usageMetadata;
  const promptTokens = meta?.promptTokenCount ?? 0;
  const completionTokens = meta?.candidatesTokenCount ?? 0;
  if (promptTokens > 0 || completionTokens > 0) {
    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };
  }
  const promptLen = JSON.stringify(messages).length + (system?.length || 0);
  return {
    promptTokens: Math.ceil(promptLen / 4),
    completionTokens: Math.ceil((text || '').length / 4),
    totalTokens: Math.ceil((promptLen + (text || '').length) / 4),
  };
}

/** Non-streaming completion */
export async function completeGeminiChat(system, messages) {
  const client = getGeminiClient();
  if (!client) throw new Error('Gemini API not configured (set GEMINI_API_KEY)');

  const response = await client.models.generateContent({
    model: getGeminiModel(),
    contents: toGeminiContents(messages),
    config: buildGeminiConfig(system),
  });

  const text = response.text ?? '';
  return { text, usage: extractUsage(response, messages, system, text) };
}

/** Streaming — emits NDJSON-compatible events via writeLine */
export async function streamGeminiChat(system, messages, writeLine) {
  const client = getGeminiClient();
  if (!client) throw new Error('Gemini API not configured (set GEMINI_API_KEY)');

  const stream = await client.models.generateContentStream({
    model: getGeminiModel(),
    contents: toGeminiContents(messages),
    config: buildGeminiConfig(system),
  });

  let fullText = '';
  let lastChunk = null;
  for await (const chunk of stream) {
    lastChunk = chunk;
    const delta = chunk.text;
    if (!delta) continue;
    fullText += delta;
    writeLine({ type: 'text', text: delta });
  }

  const usage = extractUsage(lastChunk, messages, system, fullText);
  writeLine({
    type: 'usage',
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
  });

  return fullText;
}
