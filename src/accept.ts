export interface AcceptedText {
	insert: string;
	remaining: string;
}

/**
 * The next Right-arrow chunk: a leading newline run, or the next word plus one trailing space.
 * The chunk is always a prefix of the suggestion, so the remainder stays aligned with the cursor.
 */
export function nextWordChunk(suggestion: string): string {
	if (suggestion.length === 0) return '';

	let index = 0;
	const first = suggestion[0] ?? '';
	if (isNewline(first)) {
		while (index < suggestion.length && isNewline(suggestion[index] ?? '')) index += 1;
		return suggestion.slice(0, index);
	}

	while (index < suggestion.length && isHorizontalSpace(suggestion[index] ?? '')) index += 1;
	if (index === suggestion.length) return suggestion;

	while (index < suggestion.length) {
		const char = suggestion[index] ?? '';
		if (isHorizontalSpace(char) || isNewline(char)) break;
		index += 1;
	}

	if (index < suggestion.length && isHorizontalSpace(suggestion[index] ?? '')) index += 1;
	return suggestion.slice(0, index);
}

export function acceptSuggestion(text: string, mode: 'all' | 'word'): AcceptedText {
	if (mode === 'all' || text.length === 0) return { insert: text, remaining: '' };
	const insert = nextWordChunk(text);
	if (insert.length === 0 || !text.startsWith(insert)) return { insert: text, remaining: '' };
	return { insert, remaining: text.slice(insert.length) };
}

function isNewline(char: string): boolean {
	return char === '\n' || char === '\r';
}

function isHorizontalSpace(char: string): boolean {
	return char.length > 0 && !isNewline(char) && /^\s$/u.test(char);
}
