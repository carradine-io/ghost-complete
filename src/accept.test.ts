import { describe, expect, it } from 'vitest';
import { acceptSuggestion, nextWordChunk } from './accept';

describe('next word accept', () => {
	it('splits on the next word and keeps one trailing space', () => {
		expect(nextWordChunk('hello world')).toBe('hello ');
		expect(nextWordChunk('hello')).toBe('hello');
		expect(nextWordChunk('  hello world')).toBe('  hello ');
		expect(nextWordChunk('hello  world')).toBe('hello ');
	});

	it('treats a newline run as its own chunk and stops before a newline', () => {
		expect(nextWordChunk('\n\nnext')).toBe('\n\n');
		expect(nextWordChunk('\r\nworld')).toBe('\r\n');
		expect(nextWordChunk('hello\nworld')).toBe('hello');
	});

	it('returns whitespace-only suggestions unchanged', () => {
		expect(nextWordChunk('   ')).toBe('   ');
		expect(nextWordChunk('')).toBe('');
	});

	it('keeps punctuation attached to the word', () => {
		expect(nextWordChunk('hello, world')).toBe('hello, ');
	});

	it('accepts the whole suggestion or only the next word', () => {
		expect(acceptSuggestion('hello world', 'all')).toEqual({ insert: 'hello world', remaining: '' });
		expect(acceptSuggestion('hello world', 'word')).toEqual({ insert: 'hello ', remaining: 'world' });
	});

	it('always splits into a prefix and the exact remainder', () => {
		const samples = ['hello world', '  hello world', 'hello\nworld', '\nnext', 'hello,', '   ', 'one\ttwo'];
		for (const sample of samples) {
			const chunk = nextWordChunk(sample);
			expect(chunk.length).toBeGreaterThan(0);
			expect(sample.startsWith(chunk)).toBe(true);
			const accepted = acceptSuggestion(sample, 'word');
			expect(accepted.insert + accepted.remaining).toBe(sample);
		}
	});
});
