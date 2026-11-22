/** Small LRU of completion text. Keys must not contain API keys. */
export class CompletionCache {
	private readonly entries = new Map<string, string>();

	constructor(private readonly maxEntries = 64) {}

	get(key: string): string | undefined {
		const value = this.entries.get(key);
		if (value === undefined) return undefined;
		this.entries.delete(key);
		this.entries.set(key, value);
		return value;
	}

	set(key: string, value: string): void {
		if (this.entries.has(key)) this.entries.delete(key);
		this.entries.set(key, value);
		while (this.entries.size > this.maxEntries) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) break;
			this.entries.delete(oldest);
		}
	}

	get size(): number {
		return this.entries.size;
	}

	clear(): void {
		this.entries.clear();
	}
}
