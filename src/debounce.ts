export interface Timer {
	set(callback: () => void, delayMs: number): unknown;
	clear(id: unknown): void;
}

const defaultTimer: Timer = {
	set(callback, delayMs) {
		return window.setTimeout(callback, delayMs);
	},
	clear(id) {
		window.clearTimeout(id as ReturnType<typeof window.setTimeout>);
	},
};

/**
 * Trailing-edge debounce. Scheduling again, or cancelling, drops the previous callback.
 */
export class Debouncer {
	private timerId: unknown = null;
	private generation = 0;

	constructor(private readonly timer: Timer = defaultTimer) {}

	schedule(delayMs: number, callback: () => void): void {
		this.cancel();
		const generation = ++this.generation;
		this.timerId = this.timer.set(() => {
			this.timerId = null;
			if (generation === this.generation) callback();
		}, delayMs);
	}

	cancel(): void {
		if (this.timerId !== null) {
			this.timer.clear(this.timerId);
			this.timerId = null;
		}
		this.generation += 1;
	}

	get pending(): boolean {
		return this.timerId !== null;
	}
}
