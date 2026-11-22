import { EditorView } from '@codemirror/view';
import { MarkdownView, Notice, Plugin } from 'obsidian';
import { CompletionCache } from './cache';
import { ChatCompletionClient, sanitizeError, type CompletionClient } from './completion';
import { createGhostExtension, notifyGhostSettings, type GhostHost, type StatusPhase } from './editor';
import { createObsidianHttp } from './http';
import { materializeApiKey, normalizeSettings, resolveProvider, storedSecrets, type GhostCompleteSettings, type ResolvedProvider } from './settings';
import { GhostCompleteSettingTab } from './settings-tab';

export default class GhostCompletePlugin extends Plugin implements GhostHost {
	settings: GhostCompleteSettings = normalizeSettings(undefined);
	readonly cache = new CompletionCache();
	readonly client: CompletionClient = new ChatCompletionClient(createObsidianHttp());

	private statusBar: HTMLElement | null = null;
	private settingsTab: GhostCompleteSettingTab | null = null;
	private phase: StatusPhase = 'on';
	private epoch = 0;
	private lastError = '';
	private lastErrorAt = 0;

	async onload(): Promise<void> {
		await this.loadSettings();

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

	getResolvedProvider(): ResolvedProvider {
		const resolved = resolveProvider(this.settings);
		return {
			...resolved,
			apiKey: materializeApiKey(resolved.apiKey, (id) => readPluginSecret(this, id)),
		};
	}

	getEpoch(): number {
		return this.epoch;
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
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

	reportError(error: unknown): void {
		const secrets = [...storedSecrets(this.settings), this.getResolvedProvider().apiKey];
		const message = sanitizeError(error, secrets);
		this.setPhase('error');
		const now = Date.now();
		if (message === this.lastError && now - this.lastErrorAt < 8000) return;
		this.lastError = message;
		this.lastErrorAt = now;
		new Notice(`Ghost Complete: ${message}`, 6000);
	}

	refreshStatus(): void {
		if (!this.statusBar) return;
		this.statusBar.setText(statusLabel(this.settings, this.phase, this.getResolvedProvider().apiKey));
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

function readPluginSecret(plugin: GhostCompletePlugin, id: string): string | null {
	try {
		return plugin.app.secretStorage.getSecret(id);
	} catch {
		return null;
	}
}

function editorViewOf(view: MarkdownView): EditorView | null {
	const candidate = (view.editor as { cm?: EditorView }).cm;
	if (!candidate || typeof candidate.dispatch !== 'function') return null;
	return candidate;
}
