export class AbortError extends Error {
	constructor() {
		super('The operation was aborted');
		this.name = 'AbortError';
	}
}

export function isAbortError(error: unknown): boolean {
	return error instanceof AbortError || (error instanceof Error && error.name === 'AbortError');
}

/**
 * Settle with the original promise, or reject when `signal` aborts.
 * A result that arrives after abort is ignored.
 */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(new AbortError());

	return new Promise((resolve, reject) => {
		const onAbort = () => {
			reject(new AbortError());
		};
		signal.addEventListener('abort', onAbort, { once: true });
		promise.then(
			(value) => {
				signal.removeEventListener('abort', onAbort);
				if (signal.aborted) reject(new AbortError());
				else resolve(value);
			},
			(error: unknown) => {
				signal.removeEventListener('abort', onAbort);
				reject(error instanceof Error ? error : new Error('The operation was aborted'));
			},
		);
	});
}
