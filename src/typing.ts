import type { Transaction } from '@codemirror/state';

/** Count a stretch of direct typing; navigation and other edits start a new stretch. */
export function countTypedCharacters(previous: number, transaction: Transaction): number {
	if (!transaction.docChanged) return transaction.selection ? 0 : previous;
	if (!transaction.isUserEvent('input.type') || transaction.newSelection.ranges.length !== 1) return 0;
	let added = 0;
	transaction.changes.iterChanges((_from, _to, _newFrom, _newTo, inserted) => {
		added += Array.from(inserted.toString()).length;
	});
	return previous + added;
}
