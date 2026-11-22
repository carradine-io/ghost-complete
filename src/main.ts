import { EditorView } from '@codemirror/view';
import { MarkdownView, Notice, Plugin } from 'obsidian';
import { CompletionCache } from './cache';
import {
	ChatCompletionClient,
	buildChatRequest,
	formatConnectionReport,
	probeConnection,
	sanitizeError,
	type CompletionClient,
} from './completion';
import { createGhostExtension, notifyGhostSettings, type GhostHost, type StatusPhase } from './editor';
import { createObsidianHttp } from './http';
import { PROVIDERS } from './providers';
import {
	chooseCredential,
	normalizeSettings,
	resolveProvider,
	storedSecrets,
	type GhostCompleteSettings,
	type ResolvedProvider,
} from './settings';
import { GhostCompleteSettingTab } from './settings-tab';

export default class GhostCompletePlugin extends Plugin implements GhostHost {
	settings: GhostCompleteSettings = normalizeSettings(undefined);
	readonly cache = new CompletionCache();
	private readonly http = createObsidianHttp();
	readonly client: CompletionClient = new ChatCompletionClient(this.http);
	lastConnectionReport = '';
	private activeApiKey = '';

	private statusBar: HTMLElement | null = null;
	private settingsTab: GhostCompleteSettingTab | null = null;
	private phase: StatusPhase = 'on';
	private epoch = 0;
	private lastError = '';
	private lastErrorAt = 0;

	async onload(): Promise<void> {
		await this.loadSettings();
		await this.getResolvedProvider();

		this.settingsTab = new GhostCompleteSettingTab(this.app, this);
		this.addSettingTab(this.settingsTab);
		this.addCommand({
			id: 'toggle',
			name: 'Toggle autocomplete',
			callback: () => {
				void this.setEnabled(!this.settings.enabled);
			},
		});

		this.statusBar = this.addStatusBarItem();
		this.statusBar.addClass('ghost-complete-status');
		this.statusBar.setAttr('aria-label', 'Toggle autocomplete');
		this.statusBar.setAttr('title', 'Toggle autocomplete');
		this.registerDomEvent(this.statusBar, 'click', () => {
			void this.setEnabled(!this.settings.enabled);
		});

		this.registerEditorExtension(createGhostExtension(this));
		this.refreshStatus();
	}

	getSettings(): GhostCompleteSettings {
		return this.settings;
	}

	async getResolvedProvider(): Promise<ResolvedProvider> {
		const resolved = resolveProvider(this.settings);
		const secretValue = await readSecretValue(this.app.secretStorage, resolved.secretId);
		const apiKey = chooseCredential(resolved.secretId, secretValue, resolved.directKey);
		this.activeApiKey = apiKey;
		return { ...resolved, apiKey };
	}

	getEpoch(): number {
		return this.epoch;
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		await this.getResolvedProvider();
		this.refreshStatus();
	}

	async setEnabled(enabled: boolean): Promise<void> {
		if (this.settings.enabled === enabled) return;
		this.settings.enabled = enabled;
		this.epoch += 1;
		this.phase = enabled ? 'on' : 'off';
		await this.saveSettings();
		this.forEachEditor((view) => notifyGhostSettings(view));
		const tab = this.settingsTab;
		if (tab && !tab.applyingFromControl && tab.containerEl.isConnected) tab.update();
	}

	setPhase(phase: StatusPhase): void {
		this.phase = phase;
		this.refreshStatus();
	}

	async testConnection(): Promise<string> {
		const resolved = await this.getResolvedProvider();
		const providerLabel = PROVIDERS[resolved.id].label;
		if (!resolved.apiKey) {
			return formatConnectionReport({
				providerLabel,
				keyFound: false,
				status: null,
				providerMessage: '',
			});
		}
		const request = buildChatRequest({
			providerId: resolved.id,
			apiKey: resolved.apiKey,
			model: resolved.model,
			prefix: 'Hi',
			suffix: '',
			maxTokens: 1,
		});
		const outcome = await probeConnection(this.http, request, resolved.apiKey);
		return formatConnectionReport({
			providerLabel,
			keyFound: true,
			status: outcome.status,
			providerMessage: outcome.providerMessage,
		});
	}

	reportError(error: unknown): void {
		const secrets = [...storedSecrets(this.settings), this.activeApiKey];
		const message = sanitizeError(error, secrets);
		this.setPhase('error');
		const now = Date.now();
		if (message === this.lastError && now - this.lastErrorAt < 8000) return;
		this.lastError = message;
		this.lastErrorAt = now;
		new Notice(`Ghost Complete: ${message}`, 8000);
	}

	refreshStatus(): void {
		if (!this.statusBar) return;
		this.statusBar.setText(statusLabel(this.settings, this.phase, this.activeApiKey));
	}

	private forEachEditor(visit: (view: EditorView) => void): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) return;
			const editorView = editorViewOf(view);
			if (editorView) visit(editorView);
		});
	}
}

function statusLabel(settings: GhostCompleteSettings, phase: StatusPhase, apiKey: string): string {
	if (!settings.enabled) return 'Ghost off';
	if (!apiKey) return 'Ghost: no key';
	if (phase === 'loading') return 'Ghost…';
	if (phase === 'error') return 'Ghost: error';
	return 'Ghost on';
}

async function readSecretValue(storage: { getSecret?: (id: string) => unknown } | null | undefined, id: string): Promise<string | null> {
	if (!id || !storage || typeof storage.getSecret !== 'function') return null;
	try {
		const value: unknown = await storage.getSecret(id);
		return typeof value === 'string' ? value : null;
	} catch {
		return null;
	}
}

function editorViewOf(view: MarkdownView): EditorView | null {
	const candidate = (view.editor as { cm?: EditorView }).cm;
	if (!candidate || typeof candidate.dispatch !== 'function') return null;
	return candidate;
}
