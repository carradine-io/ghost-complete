import { Prec, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
	Decoration,
	EditorView,
	keymap,
	ViewPlugin,
	WidgetType,
	type ViewUpdate,
} from '@codemirror/view';
import { acceptSuggestion } from './accept';
import { CompletionCache } from './cache';
import { CompletionSession, type CompletionClient } from './completion';
import { snapContext } from './context';
import { countTypedCharacters } from './typing';
import { Debouncer } from './debounce';
import { type GhostCompleteSettings, type ResolvedProvider } from './settings';

export type StatusPhase = 'on' | 'off' | 'loading' | 'error' | 'no-key';

export interface GhostHost {
	getSettings(): GhostCompleteSettings;
	getResolvedProvider(): Promise<ResolvedProvider>;
	getEpoch(): number;
	readonly cache: CompletionCache;
	readonly client: CompletionClient;
	setPhase(phase: StatusPhase): void;
	reportError(error: unknown): void;
	reportMissingKey(): void;
}

interface GhostSuggestion {
	from: number;
	text: string;
}

const ghostEffect = StateEffect.define<GhostSuggestion | null>();

const ghostField = StateField.define<GhostSuggestion | null>({
	create() {
		return null;
	},
	update(value, transaction) {
		for (const effect of transaction.effects) {
			if (effect.is(ghostEffect)) return effect.value;
		}
		const selectionChanged = !transaction.startState.selection.eq(transaction.newSelection);
		if (transaction.docChanged || selectionChanged) return null;
		return value;
	},
	provide(field) {
		return EditorView.decorations.compute([field], (state) => {
			const ghost = state.field(field);
			if (!ghost || ghost.text.length === 0) return Decoration.none;
			if (ghost.from < 0 || ghost.from > state.doc.length) return Decoration.none;
			return Decoration.set([
				Decoration.widget({
					widget: new GhostWidget(ghost.text),
					side: 1,
				}).range(ghost.from),
			]);
		});
	},
});

class GhostWidget extends WidgetType {
	constructor(private readonly suggestion: string) {
		super();
	}

	eq(other: WidgetType): boolean {
		return other instanceof GhostWidget && other.suggestion === this.suggestion;
	}

	toDOM(): HTMLElement {
		const span = createSpan({ cls: 'ghost-complete-suggestion', text: this.suggestion });
		span.setAttr('aria-hidden', 'true');
		return span;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

/**
 * Accept ghost text when it is showing. Returning false lets Tab and Right Arrow
 * fall through to Obsidian's normal keymap.
 */
export function acceptGhost(view: EditorView, mode: 'all' | 'word'): boolean {
	const ghost = view.state.field(ghostField, false);
	if (!ghost) return false;
	const selection = view.state.selection.main;
	if (!selection.empty || selection.head !== ghost.from) return false;

	const accepted = acceptSuggestion(ghost.text, mode);
	if (accepted.insert.length === 0) return false;
	const nextFrom = ghost.from + accepted.insert.length;
	view.dispatch({
		changes: { from: ghost.from, to: ghost.from, insert: accepted.insert },
		selection: { anchor: nextFrom },
		effects: ghostEffect.of(
			accepted.remaining.length > 0 ? { from: nextFrom, text: accepted.remaining } : null,
		),
		userEvent: 'input.complete',
	});
	return true;
}

export function dismissGhost(view: EditorView): boolean {
	const ghost = view.state.field(ghostField, false);
	if (!ghost) return false;
	view.dispatch({ effects: ghostEffect.of(null) });
	return true;
}

export function notifyGhostSettings(view: EditorView): void {
	view.dispatch({ userEvent: 'ghost-complete.refresh' });
}

export function createGhostExtension(host: GhostHost): Extension {
	return [
		ghostField,
		Prec.highest(keymap.of([
			{ key: 'Tab', run: (view) => acceptGhost(view, 'all') },
			{ key: 'ArrowRight', run: (view) => acceptGhost(view, 'word') },
			{ key: 'Escape', run: dismissGhost },
		])),
		ViewPlugin.fromClass(class {
			private readonly controller: GhostController;

			constructor(view: EditorView) {
				this.controller = new GhostController(view, host);
			}

			update(update: ViewUpdate): void {
				this.controller.handle(update);
			}

			destroy(): void {
				this.controller.destroy();
			}
		}),
	];
}

class GhostController {
	private readonly session: CompletionSession;
	private readonly debouncer = new Debouncer();
	private token = 0;
	private typedCharacters = 0;
	private seenEpoch: number;
	private destroyed = false;

	constructor(
		private readonly view: EditorView,
		private readonly host: GhostHost,
	) {
		this.session = new CompletionSession(host.client, host.cache);
		this.seenEpoch = host.getEpoch();
		this.schedule();
	}

	handle(update: ViewUpdate): void {
		if (this.seenEpoch !== this.host.getEpoch()) {
			this.seenEpoch = this.host.getEpoch();
			this.typedCharacters = 0;
			if (!this.host.getSettings().enabled) {
				this.stop();
				this.clearGhostSoon();
				this.host.setPhase('off');
				return;
			}
			this.schedule();
			return;
		}

		if (update.focusChanged && !update.view.hasFocus) {
			this.typedCharacters = 0;
			this.stop();
			this.clearGhostSoon();
			this.showIdlePhase();
			return;
		}

		if (update.docChanged || update.selectionSet || update.focusChanged) {
			for (const transaction of update.transactions) {
				this.typedCharacters = countTypedCharacters(this.typedCharacters, transaction);
			}
			this.schedule();
		}
	}

	destroy(): void {
		this.destroyed = true;
		this.stop();
	}

	private schedule(): void {
		this.stop();
		const settings = this.host.getSettings();
		if (!settings.enabled) {
			this.host.setPhase('off');
			return;
		}
		if (!this.view.hasFocus) return;
		if (this.typedCharacters < settings.minTypedChars) {
			this.showIdlePhase();
			return;
		}
		const selection = this.view.state.selection;
		if (selection.ranges.length !== 1 || !selection.main.empty) return;

		const token = this.token;
		void this.host.getResolvedProvider().then((resolved) => {
			if (this.destroyed || token !== this.token) return;
			if (!resolved.apiKey) {
				this.host.reportMissingKey();
				return;
			}
			this.host.setPhase('on');
			const delay = clamp(settings.debounceMs, 50, 5000);
			this.debouncer.schedule(delay, () => {
				void this.run();
			});
		}).catch(() => {
			if (!this.destroyed && token === this.token) this.host.setPhase('no-key');
		});
	}

	private async run(): Promise<void> {
		const token = this.token;
		const epoch = this.host.getEpoch();
		const settings = this.host.getSettings();
		if (!settings.enabled || !this.view.hasFocus) return;
		const selection = this.view.state.selection;
		if (selection.ranges.length !== 1 || !selection.main.empty) return;

		const cursor = selection.main.head;
		const doc = this.view.state.doc;
		const prefixBudget = clamp(settings.prefixChars, 100, 20000);
		const suffixBudget = clamp(settings.suffixChars, 0, 8000);
		const start = Math.max(0, cursor - prefixBudget);
		const end = Math.min(doc.length, cursor + suffixBudget);
		const context = snapContext(
			doc.sliceString(start, cursor),
			doc.sliceString(cursor, end),
			start > 0,
			end < doc.length,
		);
		if (!context.prefix.trim() && !context.suffix.trim()) {
			this.showIdlePhase();
			return;
		}

		const resolved = await this.host.getResolvedProvider();
		if (this.destroyed || token !== this.token || epoch !== this.host.getEpoch() || !this.view.hasFocus) return;
		if (!resolved.apiKey) {
			this.host.reportMissingKey();
			return;
		}

		this.host.setPhase('loading');
		try {
			const text = await this.session.request({
				providerId: resolved.id,
				apiKey: resolved.apiKey,
				model: resolved.model,
				prefix: context.prefix,
				suffix: context.suffix,
				maxTokens: clamp(settings.maxTokens, 8, 512),
			});
			if (this.destroyed || token !== this.token || epoch !== this.host.getEpoch()) return;
			if (!this.view.hasFocus) return;
			const current = this.view.state.selection.main;
			if (!current.empty || current.head !== cursor || !text) {
				this.showIdlePhase();
				return;
			}
			this.view.dispatch({ effects: ghostEffect.of({ from: cursor, text }) });
			this.showIdlePhase();
		} catch (error) {
			if (this.destroyed || token !== this.token || epoch !== this.host.getEpoch()) return;
			this.host.reportError(error);
		}
	}

	private stop(): void {
		this.token += 1;
		this.debouncer.cancel();
		this.session.cancel();
	}

	private clearGhostSoon(): void {
		queueMicrotask(() => {
			if (this.destroyed) return;
			dismissGhost(this.view);
		});
	}

	private showIdlePhase(): void {
		const token = this.token;
		const settings = this.host.getSettings();
		if (!settings.enabled) {
			this.host.setPhase('off');
			return;
		}
		void this.host.getResolvedProvider().then((resolved) => {
			if (!this.destroyed && token === this.token) this.host.setPhase(resolved.apiKey ? 'on' : 'no-key');
		}).catch(() => {
			if (!this.destroyed && token === this.token) this.host.setPhase('no-key');
		});
	}
}

function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, Math.trunc(value)));
}
