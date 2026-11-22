import { describe, expect, it } from 'vitest';
import { sliceContext } from './context';

describe('sliceContext', () => {
	it('returns the text around the cursor within the budgets', () => {
		const text = 'abcdef';
		expect(sliceContext(text, 3, 2, 2)).toEqual({ prefix: 'bc', suffix: 'de' });
	});

	it('snaps a truncated prefix to the next line and a truncated suffix to the previous line', () => {
		const text = 'partial line\nHello there\nsecond line\nand more';
		const cursor = text.indexOf('second');
		const context = sliceContext(text, cursor, 20, 16);
		expect(context.prefix.startsWith('partial')).toBe(false);
		expect(context.prefix).toBe('Hello there\n');
		expect(context.suffix.endsWith('more')).toBe(false);
		expect(context.suffix).toBe('second line');
	});

	it('keeps a partial line when the window has no newline', () => {
		expect(sliceContext('abcdefghij', 8, 4, 1)).toEqual({ prefix: 'efgh', suffix: 'i' });
	});
});
