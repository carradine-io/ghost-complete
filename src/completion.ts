import { AbortError, isAbortError } from './abort';
import { CompletionCache } from './cache';
import { postprocessCompletion } from './postprocess';
import { PROVIDERS, type ProviderId } from './providers';
import { credentialFromSecret, resolveProvider, type GhostCompleteSettings } from './settings';

export interface CompletionInput {
	providerId: ProviderId;
	apiKey: string;
	model: string;
	prefix: string;
	suffix: string;
	maxTokens: number;
}

export interface HttpResponse {
	status: number;
	body: string;
}

export interface HttpPost {
	post(url: string, headers: Record<string, string>, body: string, signal: AbortSignal): Promise<HttpResponse>;
}

export interface CompletionClient {
	complete(input: CompletionInput, signal: AbortSignal): Promise<string>;
}

export interface ChatHttpRequest {
	url: string;
	headers: Record<string, string>;
	body: string;
}

export function buildPrompt(prefix: string, suffix: string): string {
	return [
		'Continue this Markdown note at the cursor.',
		'Use the text on both sides of the cursor to decide whether the sentence is complete.',
		'Finish an unfinished sentence naturally, taking into account any text after the cursor.',
		'After a complete sentence, suggest one sentence that develops the thought using details already in the note.',
		'Match the writer’s voice, perspective, and sentence rhythm. Let the idea determine the length.',
		'Avoid generic facts, repetitive openings, and invented personal details.',
		'Return only the insertion on the current line.',
		'Do not repeat text that already appears before the cursor.',
		'Do not wrap the reply in quotes or code fences.',
		'Do not add a label, preamble, or explanation.',
		'',
		'Text before the cursor:',
		prefix,
		'',
		'Text after the cursor:',
		suffix,
		'',
		'Insertion:',
	].join('\n');
}

/**
 * Build an OpenAI-compatible chat request.
 * The URL is taken from the provider id, never from a shared or caller-supplied base URL.
 */
export function buildChatRequest(input: CompletionInput): ChatHttpRequest {
	const provider = PROVIDERS[input.providerId];
	const model = input.model.trim() || provider.defaultModel;
	const headers: Record<string, string> = {
		Authorization: `Bearer ${input.apiKey}`,
		'Content-Type': 'application/json',
	};
	const payload: Record<string, unknown> = {
		model,
		messages: [{ role: 'user', content: buildPrompt(input.prefix, input.suffix) }],
		temperature: 0.2,
		stream: false,
	};

	if (input.providerId === 'openrouter') {
		headers['X-Title'] = 'Ghost Complete';
		payload.max_tokens = input.maxTokens;
		payload.reasoning = { effort: 'none', exclude: true };
	} else {
		payload.max_completion_tokens = input.maxTokens;
		if (model.includes('gpt-oss')) {
			payload.reasoning_effort = 'low';
			payload.reasoning_format = 'hidden';
		}
	}

	return {
		url: `${provider.baseUrl}/chat/completions`,
		headers,
		body: JSON.stringify(payload),
	};
}

export interface RequestContext {
	prefix: string;
	suffix: string;
	maxTokens: number;
}

/**
 * Resolve the active provider's secret to its key, then build the chat request.
 * Returns null when that provider has no key, so the secret id is never sent.
 */
export function buildRequestForSettings(
	settings: GhostCompleteSettings,
	readSecret: (id: string) => string | null,
	context: RequestContext,
): ChatHttpRequest | null {
	const resolved = resolveProvider(settings);
	const secretValue = resolved.secretId ? readSecret(resolved.secretId) : null;
	const apiKey = credentialFromSecret(resolved.secretId, secretValue);
	if (!apiKey) return null;
	return buildChatRequest({
		providerId: resolved.id,
		apiKey,
		model: resolved.model,
		prefix: context.prefix,
		suffix: context.suffix,
		maxTokens: context.maxTokens,
	});
}

export function friendlyHttpError(
	status: number,
	detail: string,
	providerLabel: string,
	hasApiKey: boolean,
): string {
	if (status === 401 && !hasApiKey) return `No API key set for ${providerLabel}.`;
	if (status === 401) {
		const cleaned = detail.trim();
		return cleaned
			? `${providerLabel} rejected the API key (HTTP 401): ${cleaned}`
			: `${providerLabel} rejected the API key (HTTP 401).`;
	}
	const cleaned = detail.trim();
	return cleaned ? `Request failed (${status}): ${cleaned}` : `Request failed (${status}).`;
}

export interface ConnectionReport {
	providerLabel: string;
	keyFound: boolean;
	status: number | null;
	providerMessage: string;
}

export function formatConnectionReport(report: ConnectionReport): string {
	if (!report.keyFound) {
		return `${report.providerLabel}: key found: no. No API key set for ${report.providerLabel}. No request was sent.`;
	}
	const status = report.status === null ? 'no response' : `HTTP ${report.status}`;
	const detail = report.providerMessage ? ` ${report.providerMessage}` : '';
	return `${report.providerLabel}: key found: yes. ${status}.${detail}`;
}

export async function probeConnection(
	http: HttpPost,
	request: ChatHttpRequest,
	apiKey: string,
): Promise<Pick<ConnectionReport, 'status' | 'providerMessage'>> {
	try {
		const response = await http.post(request.url, request.headers, request.body, new AbortController().signal);
		if (response.status >= 200 && response.status < 300) {
			return { status: response.status, providerMessage: '' };
		}
		return {
			status: response.status,
			providerMessage: redactSecrets(readErrorMessage(response.body), [apiKey]),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : 'The request failed';
		return { status: null, providerMessage: redactSecrets(message, [apiKey]) };
	}
}

export function cacheKey(input: Pick<CompletionInput, 'providerId' | 'model' | 'prefix' | 'suffix' | 'maxTokens'>): string {
	return [input.providerId, input.model, String(input.maxTokens), input.prefix, input.suffix].join('\u0000');
}

export function readCompletionContent(body: string): string {
	const parsed: unknown = JSON.parse(body);
	if (!isRecord(parsed)) return '';
	const choice = firstRecord(parsed.choices);
	if (!choice) return '';
	const message = choice.message;
	if (isRecord(message)) {
		const fromContent = readContent(message.content);
		if (fromContent.length > 0) return fromContent;
	}
	return typeof choice.text === 'string' ? choice.text : '';
}

export function readErrorMessage(body: string): string {
	try {
		const parsed: unknown = JSON.parse(body);
		if (isRecord(parsed)) {
			const error = parsed.error;
			if (typeof error === 'string') return error;
			if (isRecord(error) && typeof error.message === 'string') return error.message;
			if (typeof parsed.message === 'string') return parsed.message;
		}
	} catch {
		// Response was not JSON.
	}
	const trimmed = body.trim();
	return trimmed.slice(0, 200) || 'Request failed';
}

export function redactSecrets(message: string, secrets: readonly string[]): string {
	let redacted = message;
	for (const secret of secrets) {
		const trimmed = secret.trim();
		if (trimmed.length < 4) continue;
		redacted = redacted.split(trimmed).join('[redacted]');
	}
	return redacted.slice(0, 300);
}

export function sanitizeError(error: unknown, secrets: readonly string[]): string {
	const message = error instanceof Error && error.message
		? error.message
		: 'The completion request failed';
	const redacted = redactSecrets(message, secrets).trim();
	return redacted || 'The completion request failed';
}

export function isUsableSuggestion(text: string): boolean {
	if (text.length === 0) return false;
	if (text.trim().length > 0) return true;
	return text.includes('\n');
}

export class ChatCompletionClient implements CompletionClient {
	constructor(private readonly http: HttpPost) {}

	async complete(input: CompletionInput, signal: AbortSignal): Promise<string> {
		if (signal.aborted) throw new AbortError();
		const request = buildChatRequest(input);
		const response = await this.http.post(request.url, request.headers, request.body, signal);
		if (signal.aborted) throw new AbortError();
		if (response.status < 200 || response.status >= 300) {
			const detail = redactSecrets(readErrorMessage(response.body), [input.apiKey]);
			throw new Error(friendlyHttpError(
				response.status,
				detail,
				PROVIDERS[input.providerId].label,
				input.apiKey.trim().length > 0,
			));
		}
		try {
			return readCompletionContent(response.body);
		} catch {
			throw new Error('The completion response was not valid JSON.');
		}
	}
}

/**
 * One in-flight completion at a time. A newer request aborts the previous signal,
 * and a response from an older generation is dropped even if the HTTP call cannot be aborted.
 */
export class CompletionSession {
	private controller: AbortController | null = null;
	private generation = 0;

	constructor(
		private readonly client: CompletionClient,
		private readonly cache: CompletionCache,
	) {}

	cancel(): void {
		this.invalidate();
	}

	async request(input: CompletionInput): Promise<string | null> {
		const key = cacheKey(input);
		const cached = this.cache.get(key);
		if (cached !== undefined) {
			this.invalidate();
			return cached;
		}

		this.controller?.abort();
		const controller = new AbortController();
		this.controller = controller;
		const generation = ++this.generation;

		try {
			const raw = await this.client.complete(input, controller.signal);
			if (generation !== this.generation || controller.signal.aborted) return null;
			const text = postprocessCompletion(raw, input.prefix);
			if (!isUsableSuggestion(text)) return null;
			this.cache.set(key, text);
			return text;
		} catch (error) {
			if (generation !== this.generation || controller.signal.aborted || isAbortError(error)) return null;
			throw error;
		} finally {
			if (this.controller === controller) this.controller = null;
		}
	}

	private invalidate(): void {
		this.generation += 1;
		this.controller?.abort();
		this.controller = null;
	}
}

function readContent(content: unknown): string {
	if (typeof content === 'string') return content;
	let text = '';
	for (const part of unknownItems(content)) {
		if (typeof part === 'string') text += part;
		else if (isRecord(part) && typeof part.text === 'string') text += part.text;
	}
	return text;
}

function firstRecord(value: unknown): Record<string, unknown> | null {
	for (const item of unknownItems(value)) {
		if (isRecord(item)) return item;
	}
	return null;
}

function unknownItems(value: unknown): unknown[] {
	if (!Array.isArray(value)) return [];
	const items: unknown[] = [];
	for (let index = 0; index < value.length; index += 1) {
		items.push(value.at(index));
	}
	return items;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
