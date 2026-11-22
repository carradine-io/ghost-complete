import { EditorState } from '@codemirror/state';
import { expect, it } from 'vitest';
import { countTypedCharacters } from './typing';
import { normalizeSettings } from './settings';

const state = EditorState.create({ doc: 'Already written.' });

it('requires typing by default on upgrade, and preserves the automatic option', () => {
	expect(normalizeSettings({}).minTypedChars).toBe(3);
	expect(normalizeSettings({ minTypedChars: 0 }).minTypedChars).toBe(0);
});

it('counts direct typing while ignoring text already in the document', () => {
	const tr = state.update({ changes: { from: 0, insert: 'ab' }, userEvent: 'input.type' });
	expect(countTypedCharacters(0, tr)).toBe(2);
	expect(countTypedCharacters(2, tr.state.update({ changes: { from: 2, insert: 'c' }, userEvent: 'input.type' }))).toBe(3);
	expect(countTypedCharacters(3, tr.state.update({ selection: { anchor: 6 } }))).toBe(0);
});

it.each(['input.paste', 'input.complete', 'undo', undefined])('does not count %s as typing', (userEvent) => {
	expect(countTypedCharacters(2, state.update({ changes: { from: 0, insert: 'abc' }, userEvent }))).toBe(0);
});
