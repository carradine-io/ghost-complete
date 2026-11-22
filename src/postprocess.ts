const FINAL_CHANNEL = /<\|channel\|>final<\|message\|>([\s\S]*?)(?:<\|return\|>|<\|end\|>|$)/i;
const THINK_BLOCK = /<think>[\s\S]*?<\/think>/gi;
const ANALYSIS_CHANNEL = /<\|channel\|>analysis<\|message\|>[\s\S]*?(?=<\|start\|>|<\|channel\|>|<\|return\|>|$)/gi;
const HARMONY_TOKEN = /<\|[^|>]+?\|>/g;
const OUTER_FENCE = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n?```$/;
const LABEL = /^(?:here(?:'s| is) (?:the |your )?(?:continuation|completion|suggestion|text)\s*[:-]\s*|continuation\s*:\s*|completion\s*:\s*|suggestion\s*:\s*|output\s*:\s*|insertion\s*:\s*)/i;

const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
	['"', '"'],
	["'", "'"],
	['“', '”'],
];

const MAX_SUGGESTION_CHARS = 2000;

/**
 * Turn a chat completion into insertion text: drop fences, labels, echoed prefix, and channel tags.
 * Leading spaces are preserved when they are part of the continuation.
 */
export function postprocessCompletion(raw: string, prefix: string): string {
	let text = raw.replace(/\r\n?/g, '\n');
	text = stripHarmony(text);
	text = text.replace(THINK_BLOCK, '');
	text = stripOuterFence(text);
	text = stripDanglingFences(text);
	text = stripPreamble(text);
	text = stripWrappingQuotes(text);
	text = stripPreamble(text);
	text = stripEchoedPrefix(text, prefix);
	const lineEnd = text.search(/[\n\u2028\u2029]/);
	const firstLine = lineEnd < 0 ? text : text.slice(0, lineEnd);
	return firstLine.trim() ? firstLine.slice(0, MAX_SUGGESTION_CHARS) : '';
}

export function stripEchoedPrefix(completion: string, prefix: string): string {
	if (prefix.length === 0 || completion.length === 0) return completion;
	const echoedPrefix = echoedRemainder(completion, prefix, 0);
	if (echoedPrefix !== null) return echoedPrefix;

	const lastLine = lastLineOf(prefix);
	const echoedLine = echoedRemainder(completion, lastLine, 8);
	if (echoedLine !== null) return echoedLine;

	const window = prefix.slice(-Math.min(prefix.length, 500));
	const max = Math.min(window.length, completion.length);
	for (let length = max; length >= 12; length -= 1) {
		const echoed = echoedRemainder(completion, window.slice(window.length - length), 12);
		if (echoed !== null) return echoed;
	}
	return completion;
}

/** Return the text after an echoed span, or null when it is not an echo on a boundary. */
function echoedRemainder(completion: string, echoed: string, minLength: number): string | null {
	if (echoed.length < minLength || !completion.startsWith(echoed)) return null;
	const rest = completion.slice(echoed.length);
	const next = rest[0] ?? '';
	// "to" + "together" must stay intact. An echo ends at a boundary or repeats a span that already ended on one.
	if (rest.length === 0 || isBoundary(next) || endsWithBoundary(echoed)) return rest;
	return null;
}

export function stripPreamble(text: string): string {
	let next = text;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const match = LABEL.exec(next);
		if (!match || match.index !== 0) break;
		next = next.slice(match[0].length);
		if (next.startsWith('\n')) next = next.slice(1);
	}
	return next;
}

export function stripWrappingQuotes(text: string): string {
	const trimmed = text.trim();
	for (const pair of QUOTE_PAIRS) {
		const open = pair[0];
		const close = pair[1];
		if (open === undefined || close === undefined) continue;
		if (trimmed.length < open.length + close.length + 1) continue;
		if (!trimmed.startsWith(open) || !trimmed.endsWith(close)) continue;
		const inner = trimmed.slice(open.length, trimmed.length - close.length);
		if (inner.includes('\n')) continue;
		return inner;
	}
	return text;
}

function stripHarmony(text: string): string {
	const final = FINAL_CHANNEL.exec(text);
	if (final?.[1] !== undefined) return final[1];
	return text.replace(ANALYSIS_CHANNEL, '').replace(HARMONY_TOKEN, '');
}

function stripOuterFence(text: string): string {
	const match = OUTER_FENCE.exec(text.trim());
	if (!match?.[1]) return text;
	return match[1];
}

function stripDanglingFences(text: string): string {
	let next = text;
	if (next.startsWith('```')) {
		const newline = next.indexOf('\n');
		next = newline === -1 ? '' : next.slice(newline + 1);
	}
	const trimmedEnd = next.trimEnd();
	if (trimmedEnd.endsWith('```')) next = trimmedEnd.slice(0, -3);
	return next;
}

function isBoundary(char: string): boolean {
	return char.length > 0 && /^[^\p{L}\p{N}]$/u.test(char);
}

function endsWithBoundary(text: string): boolean {
	const last = text[text.length - 1] ?? '';
	return isBoundary(last);
}

function lastLineOf(prefix: string): string {
	const newline = prefix.lastIndexOf('\n');
	const line = newline === -1 ? prefix : prefix.slice(newline + 1);
	return line.trim();
}
