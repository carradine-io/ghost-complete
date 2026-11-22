import { requestUrl } from 'obsidian';
import { raceAbort } from './abort';
import type { HttpPost } from './completion';

/**
 * Obsidian's requestUrl bypasses CORS but does not accept an AbortSignal.
 * The signal still drops a late response so a newer keystroke cannot apply a stale completion.
 * The socket itself may finish in the background; its body is never read after abort.
 */
export function createObsidianHttp(): HttpPost {
	return {
		async post(url, headers, body, signal) {
			const response = await raceAbort(
				requestUrl({
					url,
					method: 'POST',
					contentType: 'application/json',
					headers: plainHeaders(headers),
					body,
					throw: false,
				}),
				signal,
			);
			return { status: response.status, body: response.text };
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
