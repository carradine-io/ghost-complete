import { describe, expect, it } from 'vitest';
import { Debouncer, type Timer } from './debounce';

class FakeTimer implements Timer {
	now = 0;
	private nextId = 1;
	private tasks: Array<{ id: number; at: number; callback: () => void }> = [];

	set(callback: () => void, delayMs: number): number {
		const id = this.nextId;
		this.nextId += 1;
		this.tasks.push({ id, at: this.now + delayMs, callback });
		return id;
	}

	clear(id: unknown): void {
		this.tasks = this.tasks.filter((task) => task.id !== id);
	}

	advance(ms: number): void {
		this.now += ms;
		const due = this.tasks
			.filter((task) => task.at <= this.now)
			.sort((a, b) => a.at - b.at || a.id - b.id);
		const dueIds = new Set(due.map((task) => task.id));
		this.tasks = this.tasks.filter((task) => !dueIds.has(task.id));
		for (const task of due) task.callback();
	}
}

describe('Debouncer', () => {
	it('waits for the delay and runs once', () => {
		const timer = new FakeTimer();
		const debouncer = new Debouncer(timer);
		let calls = 0;
		debouncer.schedule(400, () => {
			calls += 1;
		});
		timer.advance(399);
		expect(calls).toBe(0);
		expect(debouncer.pending).toBe(true);
		timer.advance(1);
		expect(calls).toBe(1);
		expect(debouncer.pending).toBe(false);
	});

	it('keeps only the latest schedule', () => {
		const timer = new FakeTimer();
		const debouncer = new Debouncer(timer);
		const calls: string[] = [];
		debouncer.schedule(400, () => calls.push('first'));
		timer.advance(200);
		debouncer.schedule(400, () => calls.push('second'));
		timer.advance(400);
		expect(calls).toEqual(['second']);
	});

	it('does not run a cancelled callback', () => {
		const timer = new FakeTimer();
		const debouncer = new Debouncer(timer);
		let calls = 0;
		debouncer.schedule(400, () => {
			calls += 1;
		});
		debouncer.cancel();
		timer.advance(500);
		expect(calls).toBe(0);
		expect(debouncer.pending).toBe(false);
	});
});
