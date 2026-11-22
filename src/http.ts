import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { AbortError, raceAbort } from './abort';
import type { HttpPost } from './completion';

/** requestUrl can finish after a caller aborts. Count the underlying transfers until they settle. */
export function createObsidianHttp(requestUrl: (request: RequestUrlParam) => Promise<RequestUrlResponse>): HttpPost {
	let outstanding = 0;
	const retryAt = new Map<string, number>();
	return {
		async post(url, headers, body, signal) {
			if (signal.aborted) throw new AbortError();
			if (Date.now() < (retryAt.get(url) ?? 0)) return { status: 429, body: '' };
			if (outstanding >= 2) throw new AbortError();

			async function transfer() {
				outstanding++;
				try {
					const response = await requestUrl({
						url, method: 'POST', contentType: 'application/json',
						headers: plainHeaders(headers), body, throw: false,
					});
					if (response.status === 429) {
						const value = Object.entries(response.headers).find(([key]) => key.toLowerCase() === 'retry-after')?.[1];
						const now = Date.now();
						const parsed = value && /^\d+$/.test(value) ? now + Number(value) * 1000 : Date.parse(value ?? '');
						const until = Number.isFinite(parsed) && parsed > now ? parsed : now + 30_000;
						retryAt.set(url, Math.max(until, retryAt.get(url) ?? 0));
					}
					return { status: response.status, body: signal.aborted ? '' : response.text };
				} finally {
					outstanding--;
				}
			}
			return raceAbort(transfer(), signal);
		},
	};
}

function plainHeaders(headers: Record<string, string>): Record<string, string> {
	const copy: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		if (typeof value === 'string' && value.length > 0) copy[name] = value;
	}
	return copy;
}
