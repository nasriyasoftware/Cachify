import { TaskPriorityLevel } from '../../../src/core/queues/docs';
import globalTaskQueue from '../../../src/core/queues/globalTaskQueue'; // adjust path if needed

describe('GlobalTaskQueue', () => {
    beforeEach(async () => {
        await globalTaskQueue.waitForIdle();
    });

    test('addTask processes a single task correctly', async () => {
        const calls: string[] = [];
        const task = {
            id: 'task1',
            type: 'test',
            priority: 2 as TaskPriorityLevel,
            action: async () => {
                calls.push('action');
                return 'done';
            },
            onResolve: (result: any) => calls.push(`resolved:${result}`),
            onReject: () => calls.push('rejected'),
            onDone: () => calls.push('done'),
        };

        globalTaskQueue.addTask(task);
        // Wait for queue to process
        await globalTaskQueue.waitForIdle();

        expect(calls).toEqual(['action', 'resolved:done', 'done']);
    });

    test('bulkAddTasks processes multiple tasks in correct priority order', async () => {
        const calls: string[] = [];

        const tasks = [
            {
                id: 'low1',
                type: 'test',
                priority: 3 as TaskPriorityLevel,
                action: async () => { calls.push('low1'); return 'ok'; },
                onResolve: (result: any) => calls.push(`low1:resolved:${result}`),
                onDone: () => calls.push('low1:done'),
            },
            {
                id: 'high1',
                type: 'test',
                priority: 0 as TaskPriorityLevel,
                action: async () => { calls.push('high1'); return 'ok'; },
                onResolve: (result: any) => calls.push(`high1:resolved:${result}`),
                onDone: () => calls.push('high1:done'),
            },
            {
                id: 'med1',
                type: 'test',
                priority: 1 as TaskPriorityLevel,
                action: async () => { calls.push('med1'); return 'ok'; },
                onResolve: (result: any) => calls.push(`med1:resolved:${result}`),
                onDone: () => calls.push('med1:done'),
            }
        ];

        globalTaskQueue.bulkAddTasks(tasks);

        // Wait enough time for all tasks to process
        await globalTaskQueue.waitForIdle();

        // The queue should process high priority (0) first, then med (1), then low (3)
        expect(calls).toEqual([
            'high1', 'high1:resolved:ok', 'high1:done',
            'med1', 'med1:resolved:ok', 'med1:done',
            'low1', 'low1:resolved:ok', 'low1:done',
        ]);
    });

    test('addTask rejects duplicate task ids', () => {
        const task1 = {
            id: 'duplicate',
            type: 'test',
            priority: 2 as TaskPriorityLevel,
            action: async () => 'done',
            onResolve: () => { },
            onReject: () => { },
            onDone: () => { },
        };

        const task2 = { ...task1 };

        globalTaskQueue.addTask(task1);
        expect(() => globalTaskQueue.addTask(task2)).toThrow(/already in use/);
    });

    test('tasks with missing required fields throw errors', () => {
        expect(() => globalTaskQueue.addTask({} as any)).toThrow();
        expect(() => globalTaskQueue.addTask({ id: '', type: 'x', action: async () => { }, onResolve() { }, onReject() { } } as any)).toThrow();
        expect(() => globalTaskQueue.addTask({ id: 'x', type: '', action: async () => { }, onResolve() { }, onReject() { } } as any)).toThrow();
    });
});
