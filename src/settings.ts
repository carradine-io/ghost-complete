import { isProviderId, PROVIDERS, type ProviderId } from './providers';

export interface GhostCompleteSettings {
	enabled: boolean;
	provider: ProviderId;
	apiKeys: Record<ProviderId, string>;
	/** Editable model id. Selecting a provider replaces this with that provider's suggested default. */
	model: string;
	debounceMs: number;
	maxTokens: number;
	prefixChars: number;
	suffixChars: number;
}

export interface ResolvedProvider {
	id: ProviderId;
	baseUrl: string;
	apiKey: string;
	model: string;
}

export const DEFAULT_SETTINGS: GhostCompleteSettings = {
	enabled: true,
	provider: 'openrouter',
	apiKeys: {
		openrouter: '',
		groq: '',
	},
	model: PROVIDERS.openrouter.defaultModel,
	debounceMs: 400,
	maxTokens: 64,
	prefixChars: 2000,
	suffixChars: 400,
};

export function parseBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
	const parsed = typeof value === 'number'
		? value
		: typeof value === 'string'
			? Number.parseInt(value, 10)
			: Number.NaN;
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function normalizeSettings(data: unknown): GhostCompleteSettings {
	const raw = isRecord(data) ? data : {};
	const provider = isProviderId(raw.provider) ? raw.provider : DEFAULT_SETTINGS.provider;
	const apiKeys = isRecord(raw.apiKeys) ? raw.apiKeys : {};
	const model = typeof raw.model === 'string' && raw.model.trim()
		? raw.model
		: PROVIDERS[provider].defaultModel;

	return {
		enabled: raw.enabled !== false,
		provider,
		apiKeys: {
			openrouter: asString(apiKeys.openrouter),
			groq: asString(apiKeys.groq),
		},
		model,
		debounceMs: parseBoundedInt(raw.debounceMs, DEFAULT_SETTINGS.debounceMs, 50, 5000),
		maxTokens: parseBoundedInt(raw.maxTokens, DEFAULT_SETTINGS.maxTokens, 8, 512),
		prefixChars: parseBoundedInt(raw.prefixChars, DEFAULT_SETTINGS.prefixChars, 100, 20000),
		suffixChars: parseBoundedInt(raw.suffixChars, DEFAULT_SETTINGS.suffixChars, 0, 8000),
	};
}

/**
 * Point completions at a provider and fill in its suggested model.
 * API keys are left untouched so a Groq key can never replace an OpenRouter key, or the reverse.
 */
export function selectProvider(settings: GhostCompleteSettings, providerId: ProviderId): void {
	settings.provider = providerId;
	settings.model = PROVIDERS[providerId].defaultModel;
}

/**
 * The base URL always comes from the provider id, and the key always comes from that provider's slot.
 */
export function resolveProvider(settings: GhostCompleteSettings): ResolvedProvider {
	const provider = PROVIDERS[settings.provider];
	return {
		id: provider.id,
		baseUrl: provider.baseUrl,
		apiKey: settings.apiKeys[provider.id].trim(),
		model: settings.model.trim() || provider.defaultModel,
	};
}

export function storedSecrets(settings: GhostCompleteSettings): string[] {
	return [settings.apiKeys.openrouter, settings.apiKeys.groq];
}

/**
 * The secret setting stores an id, not the key. Read the key from Obsidian secret storage.
 * A missing secret stays empty so the id is never sent as a bearer token.
 */
export function materializeApiKey(
	storedReference: string,
	readSecret: (id: string) => string | null,
): string {
	const reference = storedReference.trim();
	if (!reference) return '';
	let secret: string | null;
	try {
		secret = readSecret(reference);
	} catch {
		return '';
	}
	if (typeof secret !== 'string') return '';
	return normalizeCredential(secret);
}

/** Make a credential safe to put in an Authorization header. */
export function normalizeCredential(value: string): string {
	let credential = value.split('\u0000').join('').replace(/[\r\n]/g, '').trim();
	credential = stripWrappingQuotes(credential);
	credential = credential.replace(/^Bearer\s+/i, '').trim();
	return stripWrappingQuotes(credential);
}

function stripWrappingQuotes(value: string): string {
	if (
		value.length > 1
		&& ((value.startsWith('"') && value.endsWith('"'))
			|| (value.startsWith("'") && value.endsWith("'")))
	) {
		return value.slice(1, -1).trim();
	}
	return value;
}

function asString(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
