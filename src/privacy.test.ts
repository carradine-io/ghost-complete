import { expect, it } from 'vitest';
import { credentialFromSecret, isExcludedNote, normalizeSettings, resolveProvider } from './settings';

it('blocks known keys assigned to the wrong destination, including wrapped credentials', () => {
	expect(credentialFromSecret('openrouter', 'secret', 'Bearer gsk_example')).toBe('');
	expect(credentialFromSecret('groq', 'secret', 'sk-or-v1-example')).toBe('');
	expect(credentialFromSecret('groq', 'secret', 'future-format')).toBe('future-format');
});

it('blocks duplicate secret links loaded from disk', () => {
	expect(resolveProvider(normalizeSettings({secretIds: {groq: 'same', openrouter: 'same'}})).secretId).toBe('');
});

it('excludes descendants, checks folder boundaries and fails closed for unknown files', () => {
	const folders = 'Private/\nWork/Customers';
	expect(isExcludedNote('private/nested/test.md', folders)).toBe(true);
	expect(isExcludedNote('Work/Customers/A.md', folders)).toBe(true);
	expect(isExcludedNote('Private Archive/test.md', folders)).toBe(false);
	expect(isExcludedNote(undefined, folders)).toBe(true);
	expect(isExcludedNote(undefined, '')).toBe(false);
});
