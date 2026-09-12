/**
 * Minimal OpenAI-protocol client — plain `fetch`, no SDK.
 *
 * Works against any OpenAI-compatible /chat/completions endpoint (OpenAI,
 * Nebius AI Studio, OpenRouter, vLLM, Ollama's bridge). Lifeline's default
 * configuration points at Nebius running Qwen3-30B-A3B-Instruct.
 *
 * THE CONTRACT: `complete()` NEVER THROWS AND NEVER HANGS.
 *
 * Everything this model is used for has a deterministic rule-based path that
 * already produced an answer before we called out. The model can only add to
 * it. So every failure mode — missing key, DNS failure, 401, 429, a 30-second
 * cold start, a truncated body, prose instead of JSON — collapses to the same
 * observable outcome: `null`, and the rules answer stands. A disaster demo
 * cannot be allowed to die because a GPU somewhere is busy.
 */

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_TOKENS = 500;

export interface CompleteOptions {
  /** Hard wall-clock budget. Default 8s. */
  timeoutMs?: number;
  maxTokens?: number;
  /** Override the configured model for one call. */
  model?: string;
  temperature?: number;
}

interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Read env at CALL time — Next.js loads .env.local after module evaluation. */
function readConfig(): LLMConfig | null {
  const baseUrl = process.env.OPENAI_BASE_URL?.trim();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, model };
}

export function isLLMConfigured(): boolean {
  return readConfig() !== null;
}

/** What the UI shows in the "AI" chip — never includes the key. */
export function describeLLM(): { configured: boolean; model: string | null; baseUrl: string | null } {
  const config = readConfig();
  return {
    configured: config !== null,
    model: config?.model ?? null,
    baseUrl: config?.baseUrl ?? null,
  };
}

/**
 * Strip everything a chat model wraps around JSON.
 *
 * Qwen3 in particular sometimes emits a `<think>…</think>` preamble and/or a
 * ```json fence. Neither is an error, so we clean rather than reject: first the
 * reasoning block, then the fence, then a final narrowing to the outermost
 * braces so leading apologies ("Sure! Here you go:") cannot break JSON.parse.
 */
export function stripToJson(raw: string): string {
  let text = raw.trim();

  // 1. reasoning preamble (open block with no close = the whole prefix)
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  text = text.replace(/^[\s\S]*?<\/think>/i, "").trim();

  // 2. markdown fences
  const fenced = /```(?:json|jsonc|javascript)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) text = fenced[1].trim();
  text = text.replace(/^```(?:json|jsonc|javascript)?/i, "").replace(/```$/, "").trim();

  // 3. narrow to the outermost JSON value
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) return text.slice(firstBrace, lastBrace + 1);

  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) return text.slice(firstBracket, lastBracket + 1);

  return text;
}

/** Parse a model response into JSON, or null. Never throws. */
export function parseJsonResponse<T = unknown>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(stripToJson(raw)) as T;
  } catch {
    return null;
  }
}

interface ChatCompletionBody {
  choices?: { message?: { content?: unknown } }[];
}

/**
 * One chat completion. Returns the assistant text, or null on ANY failure.
 *
 * `temperature: 0` because the same intake text must extract the same way
 * every time the demo is run.
 */
export async function complete(system: string, user: string, opts: CompleteOptions = {}): Promise<string | null> {
  const config = readConfig();
  if (!config) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model ?? config.model,
        // Deterministic: the demo must replay identically.
        temperature: opts.temperature ?? 0,
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) return null;

    const body = (await response.json()) as ChatCompletionBody;
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) return null;
    return content;
  } catch {
    // AbortError, DNS failure, TLS failure, malformed JSON body — all the same
    // to the caller: the rules answer stands.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
