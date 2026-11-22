import { describe, expect, it } from 'vitest';
import { CompletionCache } from './cache';

describe('CompletionCache', () => {
	it('returns a stored completion and refreshes it', () => {
		const cache = new CompletionCache(2);
		cache.set('a', '1');
		cache.set('b', '2');
		expect(cache.get('a')).toBe('1');
		cache.set('c', '3');
		expect(cache.get('b')).toBeUndefined();
		expect(cache.get('a')).toBe('1');
		expect(cache.get('c')).toBe('3');
	});

	it('evicts the oldest entry when the limit is exceeded', () => {
		const cache = new CompletionCache(2);
		cache.set('a', '1');
		cache.set('b', '2');
		cache.set('c', '3');
		expect(cache.get('a')).toBeUndefined();
		expect(cache.size).toBe(2);
	});

	it('replaces the value for an existing key', () => {
		const cache = new CompletionCache();
		cache.set('a', '1');
		cache.set('a', '2');
		expect(cache.get('a')).toBe('2');
		expect(cache.size).toBe(1);
	});
});
