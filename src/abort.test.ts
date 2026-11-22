import { describe, expect, it } from 'vitest';
import { AbortError, raceAbort } from './abort';

describe('raceAbort', () => {
	it('rejects immediately when the signal is already aborted', async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(raceAbort(Promise.resolve('late'), controller.signal)).rejects.toBeInstanceOf(AbortError);
	});

	it('rejects on abort and ignores a result that arrives later', async () => {
		const controller = new AbortController();
		let resolvePending: (value: string) => void = () => {};
		const pending = new Promise<string>((resolve) => {
			resolvePending = resolve;
		});
		const raced = raceAbort(pending, controller.signal);
		controller.abort();
		await expect(raced).rejects.toBeInstanceOf(AbortError);
		resolvePending('late');
		await Promise.resolve();
	});

	it('resolves when the request wins the race', async () => {
		const controller = new AbortController();
		await expect(raceAbort(Promise.resolve('ok'), controller.signal)).resolves.toBe('ok');
		expect(controller.signal.aborted).toBe(false);
	});
});
