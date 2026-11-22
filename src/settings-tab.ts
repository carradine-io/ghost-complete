import { Notice, PluginSettingTab, type App, type SettingDefinitionItem } from 'obsidian';
import { PROVIDERS, type ProviderId } from './providers';
import { parseBoundedInt, selectProvider, type GhostCompleteSettings } from './settings';
import type GhostCompletePlugin from './main';

const NUMBER_BOUNDS = {
	minTypedChars: { min: 0, max: 100, fallback: 3 },
	debounceMs: { min: 50, max: 5000, fallback: 400 },
	maxTokens: { min: 8, max: 512, fallback: 64 },
	prefixChars: { min: 100, max: 20000, fallback: 2000 },
	suffixChars: { min: 0, max: 8000, fallback: 400 },
} as const;

export class GhostCompleteSettingTab extends PluginSettingTab {
	private applyingControl = false;

	constructor(app: App, private readonly plugin: GhostCompletePlugin) {
		super(app, plugin);
	}

	get applyingFromControl(): boolean {
		return this.applyingControl;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const provider = PROVIDERS[this.plugin.settings.provider];
		return [
			{
				name: 'Keys stay with their provider',
				desc: 'OpenRouter and Groq each have their own base URL and their own API key. Choosing a provider switches the URL and fills in that provider\'s suggested model. Choose a different secret for each destination. Recognizable keys linked to the wrong provider are blocked locally.',
			},
			{
				name: 'Enable autocomplete',
				desc: `When enabled, suggestions send up to ${this.plugin.settings.prefixChars} characters before the cursor and ${this.plugin.settings.suffixChars} after it to ${provider.label}. OpenRouter can forward this text to a model host.`,
				control: { type: 'toggle', key: 'enabled' },
			},
			{
				name: 'Excluded folders',
				desc: 'One vault-relative folder per line. Notes in these folders and their subfolders never request suggestions.',
				control: { type: 'textarea', key: 'excludedFolders', rows: 3 },
			},
			{
				name: 'Provider',
				desc: `Requests go to ${provider.baseUrl}/chat/completions. Changing the provider replaces the model with that provider's suggested default.`,
				control: {
					type: 'dropdown',
					key: 'provider',
					options: {
						openrouter: PROVIDERS.openrouter.label,
						groq: PROVIDERS.groq.label,
					},
				},
			},
			secretKey('OpenRouter API key', 'openrouter'),
			secretKey('Groq API key', 'groq'),
			{
				name: 'Test connection',
				desc: this.plugin.lastConnectionReport
					|| 'Sends one short request with the selected provider. The result shows whether a key was found, the HTTP status, and the provider error. The key is not shown.',
				action: () => {
					void this.runConnectionTest();
				},
			},
			{
				name: 'Model',
				desc: `Suggested for ${provider.label}: ${provider.defaultModel}. Edit this after choosing a provider if you want a different model id.`,
				control: {
					type: 'text',
					key: 'model',
					placeholder: provider.defaultModel,
				},
			},
			numberSetting(
				'Minimum typed characters',
				'Type this many characters to start suggestions at the cursor. Moving the cursor or leaving the editor resets the count. Set to 0 for automatic suggestions on open and cursor movement.',
				'minTypedChars',
			),
			numberSetting(
				'Debounce',
				'How long to wait after you stop typing before requesting a suggestion, in milliseconds.',
				'debounceMs',
			),
			numberSetting(
				'Max tokens',
				'Upper bound on tokens generated for one suggestion.',
				'maxTokens',
			),
			numberSetting(
				'Context before cursor',
				'Maximum characters of note text sent from before the cursor.',
				'prefixChars',
			),
			numberSetting(
				'Context after cursor',
				'Maximum characters of note text sent from after the cursor.',
				'suffixChars',
			),
		];
	}

	override getControlValue(key: string): unknown {
		const settings = this.plugin.settings;
		switch (key) {
			case 'excludedFolders': return settings.excludedFolders;
			case 'enabled':
				return settings.enabled;
			case 'provider':
				return settings.provider;
			case 'model':
				return settings.model;
			case 'openrouterSecretId':
				return settings.secretIds.openrouter;
			case 'groqSecretId':
				return settings.secretIds.groq;
			case 'minTypedChars':
				return settings.minTypedChars;
			case 'debounceMs':
				return settings.debounceMs;
			case 'maxTokens':
				return settings.maxTokens;
			case 'prefixChars':
				return settings.prefixChars;
			case 'suffixChars':
				return settings.suffixChars;
			default:
				return undefined;
		}
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		this.applyingControl = true;
		try {
			await this.applyControl(key, value);
		} finally {
			this.applyingControl = false;
		}
	}

	private async applyControl(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings;
		switch (key) {
			case 'enabled':
				if (typeof value === 'boolean') await this.plugin.setEnabled(value);
				return;
			case 'provider':
				if (value === 'openrouter' || value === 'groq') {
					selectProvider(settings, value);
					await this.plugin.saveSettings();
					this.update();
				}
				return;
			case 'model':
				if (typeof value === 'string') settings.model = value;
				break;
			case 'excludedFolders':
				if (typeof value === 'string') settings.excludedFolders = value;
				break;
			case 'openrouterSecretId':
			case 'groqSecretId': {
				const id = key === 'groqSecretId' ? 'groq' : 'openrouter';
				const other = id === 'groq' ? 'openrouter' : 'groq';
				const secretId = typeof value === 'string' ? value.trim() : '';
				if (secretId && settings.secretIds[other].trim() === secretId) {
					new Notice('Choose a different secret for each provider.');
					this.update();
					return;
				}
				settings.secretIds[id] = secretId;
				break;
			}
			case 'minTypedChars':
			case 'debounceMs':
			case 'maxTokens':
			case 'prefixChars':
			case 'suffixChars':
				this.setNumber(settings, key, value);
				break;
			default:
				return;
		}
		await this.plugin.saveSettings();
	}

	private async runConnectionTest(): Promise<void> {
		const report = await this.plugin.testConnection();
		this.plugin.lastConnectionReport = report;
		new Notice(`Ghost Complete: ${report}`, 10000);
		this.update();
	}

	private setNumber(
		settings: GhostCompleteSettings,
		key: keyof typeof NUMBER_BOUNDS,
		value: unknown,
	): void {
		const bounds = NUMBER_BOUNDS[key];
		settings[key] = parseBoundedInt(value, bounds.fallback, bounds.min, bounds.max);
	}
}

function secretKey(name: string, providerId: ProviderId): SettingDefinitionItem {
	const provider = PROVIDERS[providerId];
	return {
		name,
		desc: `Link a secret from Obsidian's secret storage. Only the secret id is saved in plugin data. The key is sent only to ${provider.baseUrl}.`,
		control: {
			type: 'secret',
			key: providerId === 'openrouter' ? 'openrouterSecretId' : 'groqSecretId',
		},
	};
}

function numberSetting(
	name: string,
	desc: string,
	key: keyof typeof NUMBER_BOUNDS,
): SettingDefinitionItem {
	const bounds = NUMBER_BOUNDS[key];
	return {
		name,
		desc,
		control: {
			type: 'number',
			key,
			min: bounds.min,
			max: bounds.max,
			step: 1,
			defaultValue: bounds.fallback,
		},
	};
}
