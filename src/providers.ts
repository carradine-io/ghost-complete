export const PROVIDERS = {
	openrouter: {
		id: 'openrouter',
		label: 'OpenRouter',
		baseUrl: 'https://openrouter.ai/api/v1',
		defaultModel: 'google/gemini-2.5-flash-lite',
	},
	groq: {
		id: 'groq',
		label: 'Groq',
		baseUrl: 'https://api.groq.com/openai/v1',
		defaultModel: 'openai/gpt-oss-20b',
	},
} as const;

export type ProviderId = keyof typeof PROVIDERS;

export function isProviderId(value: unknown): value is ProviderId {
	return value === 'openrouter' || value === 'groq';
}
