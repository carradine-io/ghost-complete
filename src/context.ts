export interface NoteContext {
	prefix: string;
	suffix: string;
}

/**
 * Take a bounded window around the cursor and snap truncated edges to line breaks
 * so the model is not asked to continue from the middle of a word.
 */
export function sliceContext(
	text: string,
	cursor: number,
	prefixChars: number,
	suffixChars: number,
): NoteContext {
	const safeCursor = Math.max(0, Math.min(cursor, text.length));
	const prefixBudget = Math.max(0, prefixChars);
	const suffixBudget = Math.max(0, suffixChars);
	const start = Math.max(0, safeCursor - prefixBudget);
	const end = Math.min(text.length, safeCursor + suffixBudget);
	return snapContext(
		text.slice(start, safeCursor),
		text.slice(safeCursor, end),
		start > 0,
		end < text.length,
	);
}

export function snapContext(
	prefix: string,
	suffix: string,
	prefixTruncated: boolean,
	suffixTruncated: boolean,
): NoteContext {
	let nextPrefix = prefix;
	if (prefixTruncated) {
		const newline = nextPrefix.indexOf('\n');
		if (newline >= 0 && newline < nextPrefix.length - 1) {
			nextPrefix = nextPrefix.slice(newline + 1);
		}
	}

	let nextSuffix = suffix;
	if (suffixTruncated) {
		const newline = nextSuffix.lastIndexOf('\n');
		if (newline > 0) nextSuffix = nextSuffix.slice(0, newline);
	}

	return { prefix: nextPrefix, suffix: nextSuffix };
}
