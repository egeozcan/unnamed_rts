import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DebugEvents, type DebugEvent, type DebugEventType } from '../../../src/engine/debug/events.js';

describe('DebugEvents', () => {
    beforeEach(() => {
        // Clear any collector between tests
        DebugEvents.setCollector(null);
    });

    describe('emit without collector', () => {
        it('should do nothing when no collector is set', () => {
            // This should not throw
            expect(() => {
                DebugEvents.emit('command', { tick: 1, data: { action: 'move' } });
            }).not.toThrow();
        });
    });

    describe('emit with collector', () => {
        it('should call collector with correct event structure when set', () => {
            const collector = vi.fn();
            DebugEvents.setCollector(collector);

            DebugEvents.emit('command', {
                tick: 100,
                playerId: 1,
                entityId: 'unit-1',
                data: { action: 'attack', target: 'unit-2' }
            });

            expect(collector).toHaveBeenCalledTimes(1);
            expect(collector).toHaveBeenCalledWith({
                type: 'command',
                tick: 100,
                playerId: 1,
                entityId: 'unit-1',
                data: { action: 'attack', target: 'unit-2' }
            });
        });

        it('should include optional fields when provided', () => {
            const collector = vi.fn();
            DebugEvents.setCollector(collector);

            DebugEvents.emit('decision', {
                tick: 50,
                playerId: 2,
                data: { choice: 'build', reason: 'economy' }
            });

            const event = collector.mock.calls[0][0] as DebugEvent;
            expect(event.type).toBe('decision');
            expect(event.tick).toBe(50);
            expect(event.playerId).toBe(2);
            expect(event.entityId).toBeUndefined();
            expect(event.data).toEqual({ choice: 'build', reason: 'economy' });
        });

        it('should work without optional playerId and entityId', () => {
            const collector = vi.fn();
            DebugEvents.setCollector(collector);

            DebugEvents.emit('state-change', {
                tick: 200,
                data: { field: 'credits', oldValue: 1000, newValue: 1500 }
            });

            const event = collector.mock.calls[0][0] as DebugEvent;
            expect(event.type).toBe('state-change');
            expect(event.tick).toBe(200);
            expect(event.playerId).toBeUndefined();
            expect(event.entityId).toBeUndefined();
            expect(event.data).toEqual({ field: 'credits', oldValue: 1000, newValue: 1500 });
        });
    });

    describe('setCollector(null)', () => {
        it('should stop further events from being collected', () => {
            const collector = vi.fn();
            DebugEvents.setCollector(collector);

            DebugEvents.emit('command', { tick: 1, data: { action: 'first' } });
            expect(collector).toHaveBeenCalledTimes(1);

            DebugEvents.setCollector(null);

            DebugEvents.emit('command', { tick: 2, data: { action: 'second' } });
            expect(collector).toHaveBeenCalledTimes(1); // Still 1, not 2
        });

        it('should allow setting a new collector after clearing', () => {
            const collector1 = vi.fn();
            const collector2 = vi.fn();

            DebugEvents.setCollector(collector1);
            DebugEvents.emit('command', { tick: 1, data: {} });
            expect(collector1).toHaveBeenCalledTimes(1);

            DebugEvents.setCollector(null);
            DebugEvents.setCollector(collector2);

            DebugEvents.emit('command', { tick: 2, data: {} });
            expect(collector1).toHaveBeenCalledTimes(1); // Not called again
            expect(collector2).toHaveBeenCalledTimes(1); // New collector called
        });
    });

    describe('all event types', () => {
        const eventTypes: DebugEventType[] = [
            'command',
            'decision',
            'state-change',
            'group',
            'economy',
            'production',
            'threat'
        ];

        it.each(eventTypes)('should emit %s event type correctly', (eventType) => {
            const collector = vi.fn();
            DebugEvents.setCollector(collector);

            DebugEvents.emit(eventType, {
                tick: 42,
                data: { eventType }
            });

            expect(collector).toHaveBeenCalledTimes(1);
            const event = collector.mock.calls[0][0] as DebugEvent;
            expect(event.type).toBe(eventType);
        });

        it('should have exactly 7 event types', () => {
            expect(eventTypes.length).toBe(7);
        });
    });

    describe('multiple events', () => {
        it('should collect multiple events in sequence', () => {
            const collector = vi.fn();
            DebugEvents.setCollector(collector);

            DebugEvents.emit('command', { tick: 1, data: { n: 1 } });
            DebugEvents.emit('decision', { tick: 2, data: { n: 2 } });
            DebugEvents.emit('economy', { tick: 3, data: { n: 3 } });

            expect(collector).toHaveBeenCalledTimes(3);

            const events = collector.mock.calls.map(call => call[0] as DebugEvent);
            expect(events[0].type).toBe('command');
            expect(events[1].type).toBe('decision');
            expect(events[2].type).toBe('economy');
        });
    });
});
