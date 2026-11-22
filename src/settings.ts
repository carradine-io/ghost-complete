import { isProviderId, PROVIDERS, type ProviderId } from './providers';

export interface GhostCompleteSettings {
	enabled: boolean;
	provider: ProviderId;
	/** Obsidian secret-storage ids. The secret values are not stored here. */
	secretIds: Record<ProviderId, string>;
	/** Editable model id. Selecting a provider replaces this with that provider's suggested default. */
	model: string;
	minTypedChars: number;
	debounceMs: number;
	maxTokens: number;
	prefixChars: number;
	suffixChars: number;
}

export interface ResolvedProvider {
	id: ProviderId;
	baseUrl: string;
	model: string;
	secretId: string;
	/** Credential from secret storage. Empty when no secret resolves. */
	apiKey: string;
}

/** Fields that must never remain in plugin data. */
export const PLAINTEXT_KEY_FIELDS = ['apiKeys', 'apiKey', 'openrouterApiKey', 'groqApiKey'] as const;

export const DEFAULT_SETTINGS: GhostCompleteSettings = {
	enabled: true,
	provider: 'openrouter',
	secretIds: {
		openrouter: '',
		groq: '',
	},
	model: PROVIDERS.openrouter.defaultModel,
	minTypedChars: 3,
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
	const legacyKeys = isRecord(raw.apiKeys) ? raw.apiKeys : {};
	const storedSecretIds = isRecord(raw.secretIds) ? raw.secretIds : null;
	const secretIds = storedSecretIds ?? {};
	const openrouterSecretId = secretIdFromLegacy(asString(legacyKeys.openrouter), asString(secretIds.openrouter));
	const groqSecretId = secretIdFromLegacy(asString(legacyKeys.groq), asString(secretIds.groq));
	const model = typeof raw.model === 'string' && raw.model.trim()
		? raw.model
		: PROVIDERS[provider].defaultModel;

	return {
		enabled: raw.enabled !== false,
		provider,
		secretIds: {
			openrouter: openrouterSecretId,
			groq: groqSecretId,
		},
		model,
		minTypedChars: parseBoundedInt(raw.minTypedChars, DEFAULT_SETTINGS.minTypedChars, 0, 100),
		debounceMs: parseBoundedInt(raw.debounceMs, DEFAULT_SETTINGS.debounceMs, 50, 5000),
		maxTokens: parseBoundedInt(raw.maxTokens, DEFAULT_SETTINGS.maxTokens, 8, 512),
		prefixChars: parseBoundedInt(raw.prefixChars, DEFAULT_SETTINGS.prefixChars, 100, 20000),
		suffixChars: parseBoundedInt(raw.suffixChars, DEFAULT_SETTINGS.suffixChars, 0, 8000),
	};
}

/**
 * Point completions at a provider and fill in its suggested model.
 * Secret ids are left untouched so a Groq secret can never replace an OpenRouter secret, or the reverse.
 */
export function selectProvider(settings: GhostCompleteSettings, providerId: ProviderId): void {
	settings.provider = providerId;
	settings.model = PROVIDERS[providerId].defaultModel;
}

/**
 * The base URL always comes from the provider id.
 * apiKey stays empty until a secret value is resolved.
 */
export function resolveProvider(settings: GhostCompleteSettings): ResolvedProvider {
	const provider = PROVIDERS[settings.provider];
	return {
		id: provider.id,
		baseUrl: provider.baseUrl,
		model: settings.model.trim() || provider.defaultModel,
		secretId: settings.secretIds[provider.id].trim(),
		apiKey: '',
	};
}

/**
 * Return the secret value only. An unresolved id is never used as a token.
 */
export function credentialFromSecret(secretId: string, secretValue: string | null): string {
	if (!secretId.trim() || typeof secretValue !== 'string') return '';
	const credential = normalizeCredential(secretValue);
	if (!credential || credential === secretId.trim()) return '';
	return credential;
}

export function hasPlaintextKeyFields(data: unknown): boolean {
	if (!isRecord(data)) return false;
	return PLAINTEXT_KEY_FIELDS.some((field) => field in data);
}

export function prepareSettings(data: unknown): { settings: GhostCompleteSettings; removedPlaintext: boolean } {
	return {
		settings: normalizeSettings(data),
		removedPlaintext: hasPlaintextKeyFields(data),
	};
}

export function looksLikeSecretId(value: string): boolean {
	return /^[a-z0-9-]{1,64}$/.test(value);
}

function secretIdFromLegacy(rawKey: string, rawSecretId: string): string {
	const secretId = rawSecretId.trim();
	if (secretId) return secretId;
	return looksLikeSecretId(rawKey) ? rawKey : '';
}

export function storedSecrets(settings: GhostCompleteSettings): string[] {
	return [settings.secretIds.openrouter, settings.secretIds.groq];
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
