import { describe, expect, it } from 'vitest';
import { AbortError } from './abort';
import { CompletionCache } from './cache';
import {
	ChatCompletionClient,
	CompletionSession,
	buildChatRequest,
	buildRequestForSettings,
	cacheKey,
	formatConnectionReport,
	friendlyHttpError,
	probeConnection,
	readCompletionContent,
	redactSecrets,
	type CompletionClient,
	type CompletionInput,
	type HttpPost,
} from './completion';
import { PROVIDERS } from './providers';
import {
	DEFAULT_SETTINGS,
	normalizeSettings,
	resolveProvider,
	selectProvider,
} from './settings';

function input(overrides: Partial<CompletionInput> = {}): CompletionInput {
	return {
		providerId: 'openrouter',
		apiKey: 'openrouter-test-key',
		model: PROVIDERS.openrouter.defaultModel,
		prefix: 'Hello',
		suffix: '',
		maxTokens: 64,
		...overrides,
	};
}

describe('provider routing', () => {
	it('uses the default fast models and a 400ms debounce', () => {
		expect(DEFAULT_SETTINGS.debounceMs).toBe(400);
		expect(DEFAULT_SETTINGS.provider).toBe('openrouter');
		expect(PROVIDERS.openrouter.defaultModel).toBe('google/gemini-2.5-flash-lite');
		expect(PROVIDERS.groq.defaultModel).toBe('openai/gpt-oss-20b');
		expect(PROVIDERS.openrouter.baseUrl).toBe('https://openrouter.ai/api/v1');
		expect(PROVIDERS.groq.baseUrl).toBe('https://api.groq.com/openai/v1');
	});

	it('keeps each provider key on that provider URL when the provider changes', () => {
		const settings = normalizeSettings({
			provider: 'openrouter',
			apiKeys: { openrouter: 'sk-or-v1_test_key', groq: 'gsk_test_key' },
			model: 'custom/model',
		});

		const openrouter = resolveProvider(settings);
		expect(openrouter.baseUrl).toBe('https://openrouter.ai/api/v1');
		expect(openrouter.directKey).toBe('sk-or-v1_test_key');
		expect(openrouter.model).toBe('custom/model');

		selectProvider(settings, 'groq');
		const groq = resolveProvider(settings);
		expect(groq.id).toBe('groq');
		expect(groq.baseUrl).toBe('https://api.groq.com/openai/v1');
		expect(groq.directKey).toBe('gsk_test_key');
		expect(groq.model).toBe('openai/gpt-oss-20b');
		expect(settings.apiKeys.openrouter).toBe('sk-or-v1_test_key');
		expect(settings.apiKeys.groq).toBe('gsk_test_key');
	});

	it('sends an OpenRouter key only to OpenRouter', () => {
		const request = buildChatRequest(input());
		expect(request.url).toBe('https://openrouter.ai/api/v1/chat/completions');
		expect(request.headers.Authorization).toBe('Bearer openrouter-test-key');
		expect(request.headers['x-api-key']).toBe('openrouter-test-key');
		expect(request.url).not.toContain('openrouter-test-key');
		expect(request.body).not.toContain('openrouter-test-key');
		expect(request.headers['X-Title']).toBe('Ghost Complete');
		const payload = JSON.parse(request.body) as {
			max_tokens: number;
			reasoning: { effort: string; exclude: boolean };
			model: string;
		};
		expect(payload.model).toBe('google/gemini-2.5-flash-lite');
		expect(payload.max_tokens).toBe(64);
		expect(payload.reasoning).toEqual({ effort: 'none', exclude: true });
	});

	it('sends a Groq key only to Groq and asks gpt-oss for a short answer', () => {
		const request = buildChatRequest(input({
			providerId: 'groq',
			apiKey: 'groq-test-key',
			model: 'openai/gpt-oss-20b',
			maxTokens: 32,
		}));
		expect(request.url).toBe('https://api.groq.com/openai/v1/chat/completions');
		expect(request.headers.Authorization).toBe('Bearer groq-test-key');
		expect(request.url).not.toContain('groq-test-key');
		expect(request.body).not.toContain('groq-test-key');
		expect(request.body).not.toContain('openrouter');
		const payload = JSON.parse(request.body) as {
			max_completion_tokens: number;
			max_tokens?: number;
			reasoning_effort: string;
			reasoning_format: string;
		};
		expect(payload.max_completion_tokens).toBe(32);
		expect(payload.max_tokens).toBeUndefined();
		expect(payload.reasoning_effort).toBe('low');
		expect(payload.reasoning_format).toBe('hidden');
	});

	it('sends Authorization Bearer for the active provider secret, not the secret id', () => {
		const settings = normalizeSettings({
			provider: 'openrouter',
			apiKeys: { openrouter: 'ghost-openrouter', groq: 'ghost-groq' },
			model: 'google/gemini-2.5-flash-lite',
		});
		const secrets: Record<string, string> = {
			'ghost-openrouter': 'Bearer "sk-or-v1-active-key"\n',
			'ghost-groq': 'gsk_other-provider-key',
		};
		const readSecret = (id: string) => secrets[id] ?? null;
		const request = buildRequestForSettings(settings, readSecret, {
			prefix: 'Hello',
			suffix: '',
			maxTokens: 64,
		});
		expect(request).not.toBeNull();
		expect(request?.headers.Authorization).toBe('Bearer sk-or-v1-active-key');
		expect(request?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
		expect(request?.headers.Authorization).not.toContain('ghost-openrouter');
		expect(request?.body).not.toContain('gsk_other-provider-key');
		expect(request?.body).not.toContain('ghost-groq');
		expect(request?.url).not.toContain('sk-or-v1-active-key');

		selectProvider(settings, 'groq');
		const groq = buildRequestForSettings(settings, readSecret, {
			prefix: 'Hello',
			suffix: '',
			maxTokens: 32,
		});
		expect(groq?.headers.Authorization).toBe('Bearer gsk_other-provider-key');
		expect(groq?.url).toBe('https://api.groq.com/openai/v1/chat/completions');
		expect(groq?.body).not.toContain('sk-or-v1-active-key');
	});

	it('does not send a request when the linked secret has no value', () => {
		const settings = normalizeSettings({
			provider: 'openrouter',
			apiKeys: { openrouter: 'ghost-openrouter', groq: '' },
		});
		expect(buildRequestForSettings(settings, () => null, {
			prefix: 'Hello',
			suffix: '',
			maxTokens: 64,
		})).toBeNull();
		expect(friendlyHttpError(401, 'Missing Authentication header', 'OpenRouter', false))
			.toBe('No API key is set for OpenRouter.');
	});

	it('uses the password-field key when secret storage returns nothing', () => {
		const settings = normalizeSettings({
			provider: 'openrouter',
			apiKeys: { openrouter: 'sk-or-v1_password_key', groq: 'gsk_other_provider_key' },
			secretIds: { openrouter: 'missing-secret', groq: 'ghost-groq' },
		});
		const request = buildRequestForSettings(settings, () => null, {
			prefix: 'Hello',
			suffix: '',
			maxTokens: 16,
		});
		expect(request?.headers.Authorization).toBe('Bearer sk-or-v1_password_key');
		expect(request?.headers.Authorization).not.toContain('missing-secret');
		expect(request?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
		expect(request?.body).not.toContain('gsk_other_provider_key');
	});

	it('omits Groq reasoning fields for models that are not gpt-oss', () => {
		const request = buildChatRequest(input({
			providerId: 'groq',
			apiKey: 'groq-test-key',
			model: 'some-other-model',
		}));
		const payload = JSON.parse(request.body) as { reasoning_effort?: string };
		expect(payload.reasoning_effort).toBeUndefined();
		expect(request.url.startsWith('https://api.groq.com/')).toBe(true);
	});
});

describe('response reading', () => {
	it('reads string content and content parts', () => {
		expect(readCompletionContent(JSON.stringify({
			choices: [{ message: { content: ' world' } }],
		}))).toBe(' world');
		expect(readCompletionContent(JSON.stringify({
			choices: [{ message: { content: [{ type: 'text', text: 'hello' }] } }],
		}))).toBe('hello');
	});

	it('redacts secrets from error text', () => {
		const redacted = redactSecrets('bad key groq-test-key', ['groq-test-key']);
		expect(redacted).toContain('[redacted]');
		expect(redacted).not.toContain('groq-test-key');
	});
});

describe('CompletionSession', () => {
	it('aborts the previous request and ignores it', async () => {
		const signals: AbortSignal[] = [];
		const resolvers: Array<(value: string) => void> = [];
		const client: CompletionClient = {
			complete(_input, signal) {
				signals.push(signal);
				return new Promise((resolve, reject) => {
					signal.addEventListener('abort', () => reject(new AbortError()), { once: true });
					resolvers.push(resolve);
				});
			},
		};
		const session = new CompletionSession(client, new CompletionCache());
		const first = session.request(input({ prefix: 'one' }));
		const second = session.request(input({ prefix: 'two' }));
		expect(signals[0]?.aborted).toBe(true);
		resolvers[1]?.('fresh words');
		await expect(first).resolves.toBeNull();
		await expect(second).resolves.toBe('fresh words');
	});

	it('drops a stale response that resolves after a newer request', async () => {
		const resolvers: Array<(value: string) => void> = [];
		const client: CompletionClient = {
			complete() {
				return new Promise((resolve) => {
					resolvers.push(resolve);
				});
			},
		};
		const cache = new CompletionCache();
		const session = new CompletionSession(client, cache);
		const firstInput = input({ prefix: 'alpha' });
		const secondInput = input({ prefix: 'beta' });
		const first = session.request(firstInput);
		const second = session.request(secondInput);
		resolvers[0]?.('stale');
		resolvers[1]?.('fresh');
		await expect(first).resolves.toBeNull();
		await expect(second).resolves.toBe('fresh');
		expect(cache.get(cacheKey(firstInput))).toBeUndefined();
		expect(cache.get(cacheKey(secondInput))).toBe('fresh');
	});

	it('returns null when cancelled before the response arrives', async () => {
		let resolveRequest: (value: string) => void = () => {};
		const client: CompletionClient = {
			complete() {
				return new Promise((resolve) => {
					resolveRequest = resolve;
				});
			},
		};
		const session = new CompletionSession(client, new CompletionCache());
		const pending = session.request(input());
		session.cancel();
		resolveRequest('too late');
		await expect(pending).resolves.toBeNull();
	});

	it('serves a second identical request from the cache', async () => {
		let calls = 0;
		const client: CompletionClient = {
			async complete() {
				calls += 1;
				return ' cached-text';
			},
		};
		const session = new CompletionSession(client, new CompletionCache());
		await expect(session.request(input())).resolves.toBe(' cached-text');
		await expect(session.request(input())).resolves.toBe(' cached-text');
		expect(calls).toBe(1);
	});

	it('does not cache an empty completion', async () => {
		let calls = 0;
		const client: CompletionClient = {
			async complete() {
				calls += 1;
				return '   ';
			},
		};
		const session = new CompletionSession(client, new CompletionCache());
		await expect(session.request(input())).resolves.toBeNull();
		await expect(session.request(input())).resolves.toBeNull();
		expect(calls).toBe(2);
	});

	it('redacts the API key from a failed HTTP response', async () => {
		const http: HttpPost = {
			async post() {
				return {
					status: 401,
					body: JSON.stringify({ error: { message: 'rejected openrouter-test-key' } }),
				};
			},
		};
		const session = new CompletionSession(new ChatCompletionClient(http), new CompletionCache());
		await expect(session.request(input())).rejects.toThrow(
			'OpenRouter rejected the API key (HTTP 401): rejected [redacted]',
		);
		try {
			await session.request(input());
		} catch (error) {
			const message = error instanceof Error ? error.message : '';
			expect(message).not.toContain('openrouter-test-key');
		}
	});

	it('reports a connection test without revealing the key', async () => {
		const apiKey = 'sk-or-v1_password_key';
		const request = buildChatRequest(input({ apiKey }));
		const http: HttpPost = {
			async post() {
				return {
					status: 401,
					body: JSON.stringify({ error: { message: `Missing Authentication header ${apiKey}` } }),
				};
			},
		};
		const outcome = await probeConnection(http, request, apiKey);
		const report = formatConnectionReport({
			providerLabel: 'OpenRouter',
			keyFound: true,
			status: outcome.status,
			providerMessage: outcome.providerMessage,
		});
		expect(report).toBe('OpenRouter: key found: yes. HTTP 401. Missing Authentication header [redacted]');
		expect(report).not.toContain(apiKey);
		expect(formatConnectionReport({
			providerLabel: 'OpenRouter',
			keyFound: false,
			status: null,
			providerMessage: '',
		})).toBe('OpenRouter: key found: no. No request was sent.');
	});
});
