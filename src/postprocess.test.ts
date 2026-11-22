import { describe, expect, it } from 'vitest';
import { postprocessCompletion, stripEchoedPrefix } from './postprocess';

describe('postprocessCompletion', () => {
	it('keeps a leading space that belongs to the continuation', () => {
		expect(postprocessCompletion(' world', 'Hello')).toBe(' world');
	});

	it('strips a surrounding code fence', () => {
		expect(postprocessCompletion('```md\n world\n```', 'Hello')).toBe(' world');
	});

	it('strips wrapping quotes', () => {
		expect(postprocessCompletion('"world"', 'Hello')).toBe('world');
		expect(postprocessCompletion('“world”', 'Hello')).toBe('world');
	});

	it('strips a continuation label and a fenced label', () => {
		expect(postprocessCompletion('Continuation: world', '')).toBe('world');
		expect(postprocessCompletion("Here's the continuation:\nmore", '')).toBe('more');
		expect(postprocessCompletion('```\nInsertion: hello\n```', '')).toBe('hello');
	});

	it('strips an echoed prefix on a word boundary and keeps a longer word', () => {
		expect(postprocessCompletion('Hello world', 'Hello')).toBe(' world');
		expect(postprocessCompletion('Hello world!', 'Hello world')).toBe('!');
		expect(postprocessCompletion('Hello world', 'Hello ')).toBe('world');
		expect(stripEchoedPrefix('together', 'to')).toBe('together');
	});

	it('strips an echoed last line without eating a short accidental overlap', () => {
		expect(postprocessCompletion('The quick brown fox', 'note\nThe quick brown')).toBe(' fox');
		expect(stripEchoedPrefix('ingenuity', 'The king')).toBe('ingenuity');
	});

	it('strips a long echoed tail that is not the whole prefix', () => {
		expect(stripEchoedPrefix('abcdefghijkl tail', 'KEEP abcdefghijkl')).toBe(' tail');
	});

	it('drops think blocks and harmony analysis, keeping the final channel', () => {
		expect(postprocessCompletion('<think>secret</think> world', '')).toBe(' world');
		const harmony = '<|channel|>analysis<|message|>The user wants a continuation.<|end|><|start|>assistant<|channel|>final<|message|> and the rain fell<|return|>';
		expect(postprocessCompletion(harmony, '')).toBe(' and the rain fell');
	});

	it('returns nothing for a label with no insertion', () => {
		expect(postprocessCompletion('Continuation:', '')).toBe('');
	});

	it('keeps the first line and discards follow-up bullets', () => {
		const line = ' This is useful for saving time and reducing typos.';
		expect(postprocessCompletion(line + '\n\n- First benefit\n- Second benefit', '')).toBe(line);
		expect(postprocessCompletion('\n- New item', '')).toBe('');
	});

	it('handles CRLF and caps runaway length', () => {
		expect(postprocessCompletion('hello\r\nworld', '')).toBe('hello');
		const long = 'x'.repeat(2500);
		expect(postprocessCompletion(long, '').length).toBe(2000);
	});

	it('strips a fence that was opened and not closed', () => {
		expect(postprocessCompletion('```markdown\nhello', '')).toBe('hello');
	});
});
