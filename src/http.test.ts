import { expect, it, vi } from 'vitest';
import { createObsidianHttp } from './http';

it('bounds actual transfers after a caller aborts and backs off on 429', async () => {
	const response = { status: 429, headers: { 'Retry-After': '60' }, text: '', json: {}, arrayBuffer: new ArrayBuffer(0) };
	let finish!: (value: typeof response) => void;
	const pending = new Promise<typeof response>(resolve => { finish = resolve; });
	const requestUrl = vi.fn(() => pending);
	const http = createObsidianHttp(requestUrl);
	const controller = new AbortController();
	const send = (signal = new AbortController().signal) => http.post('https://example.test', {}, '', signal);
	const first = send(controller.signal);
	controller.abort();
	await expect(first).rejects.toThrow();
	const second = send();
	await expect(send()).rejects.toThrow();
	expect(requestUrl).toHaveBeenCalledTimes(2);
	finish(response);
	await second;
	expect((await send()).status).toBe(429);
	expect(requestUrl).toHaveBeenCalledTimes(2);
});
