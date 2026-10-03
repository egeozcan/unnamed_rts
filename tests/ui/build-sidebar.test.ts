// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
    getBuildBlockers,
    computeTooltipPosition,
    formatBuildStatus,
    buildSelectionSummaryHtml,
    updateCommandBar,
    TooltipRect
} from '../../src/ui/index';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer';
import { GameState, Entity } from '../../src/engine/types';
import {
    createTestBuilding,
    createTestAirforceCommand,
    createTestHarrier,
    createTestCombatUnit,
    resetTestEntityCounter
} from '../../src/engine/test-utils';

function entitiesOf(...list: Entity[]): Record<string, Entity> {
    return Object.fromEntries(list.map(e => [e.id, e]));
}

function rect(left: number, top: number, width: number, height: number): TooltipRect {
    return { left, top, width, height, right: left + width, bottom: top + height };
}

function stateWith(entities: Entity[], selection: string[]): GameState {
    return {
        ...INITIAL_STATE,
        mode: 'game',
        players: { 0: createPlayerState(0, false), 1: createPlayerState(1, true) },
        entities: entitiesOf(...entities),
        selection
    } as GameState;
}

beforeEach(() => resetTestEntityCounter());

describe('getBuildBlockers (H-7)', () => {
    it('names the missing production building (Heli with Tech Center but no Air-Force Command)', () => {
        const entities = entitiesOf(
            createTestBuilding({ key: 'conyard' }),
            createTestBuilding({ key: 'tech' })
        );
        const b = getBuildBlockers('heli', 'air', 0, entities);
        expect(b.missingProductionBuilding).toBe(true);
        expect(b.missingPrereqs).toEqual(['Air-Force Command']);
    });

    it('does not repeat the production building when it is also a prerequisite', () => {
        const b = getBuildBlockers('harrier', 'air', 0, {});
        expect(b.missingPrereqs.filter(n => n === 'Air-Force Command')).toHaveLength(1);
    });

    it('reports full aircraft pads', () => {
        const base = createTestAirforceCommand();
        const harriers = Array.from({ length: 5 }, () => createTestHarrier({ state: 'flying' }));
        const entities = entitiesOf(createTestBuilding({ key: 'conyard' }), base, ...harriers);

        const free = getBuildBlockers('harrier', 'air', 0, entities, { current: null, queued: [] });
        expect(free.airPads).toEqual({ total: 6, used: 5 });
        expect(free.airPadsFull).toBe(false);

        const full = getBuildBlockers('harrier', 'air', 0, entities, { current: 'harrier', queued: [] });
        expect(full.airPadsFull).toBe(true);
    });

    it('reports the maxCount limit', () => {
        const entities = entitiesOf(
            createTestBuilding({ key: 'conyard' }),
            createTestBuilding({ key: 'factory' }),
            createTestBuilding({ key: 'tech' })
        );
        const b = getBuildBlockers('tech', 'building', 0, entities);
        expect(b.limitReached).toBe(true);
        expect(b.maxCount).toBe(1);
    });
});

describe('computeTooltipPosition (H-8 / V-18 / R2F-2)', () => {
    it('hangs off the sidebar left edge so it never covers a build button', () => {
        const sidebar = rect(1620, 0, 300, 1080);
        const btn = rect(1770, 600, 145, 60); // right column
        const pos = computeTooltipPosition(btn, sidebar, 220, 140, 1920, 1080);
        expect(pos.left + 220).toBeLessThanOrEqual(sidebar.left);
        expect(pos.top).toBe(600);
    });

    it('clamps to the bottom of a 720p viewport', () => {
        const sidebar = rect(980, 0, 300, 720);
        const btn = rect(985, 680, 145, 50);
        const pos = computeTooltipPosition(btn, sidebar, 220, 130, 1280, 720);
        expect(pos.top + 130).toBeLessThanOrEqual(720 - 8);
    });

    it('stays on screen in portrait with the sidebar at the bottom', () => {
        const sidebar = rect(0, 464, 390, 380);
        const btn = rect(5, 620, 125, 48);
        const pos = computeTooltipPosition(btn, sidebar, 220, 140, 390, 844);
        expect(pos.left).toBeGreaterThanOrEqual(8);
        expect(pos.left + 220).toBeLessThanOrEqual(390 - 8);
        expect(pos.top + 140).toBeLessThanOrEqual(sidebar.top);
    });
});

describe('formatBuildStatus (V-13 / H-17)', () => {
    it('shows the percentage of the item being built', () => {
        expect(formatBuildStatus(42.7, false)).toBe('42%');
        expect(formatBuildStatus(42.7, true)).toBe('NO FUNDS 42%');
    });
});

describe('selection summary + command bar (H-11)', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <canvas id="gameCanvas"></canvas>
            <div id="selection-panel" class="hidden"></div>
            <div id="command-bar" class="command-bar hidden">
                <div class="stance-section"></div>
                <div class="attack-move-section"><button id="attack-move-btn"></button></div>
                <button id="ungarrison-btn" class="hidden"></button>
            </div>`;
    });

    it('summarises a multi-selection by type with combined HP', () => {
        const a = createTestCombatUnit({ key: 'rifle', hp: 50, maxHp: 100 });
        const b = createTestCombatUnit({ key: 'rifle', hp: 100, maxHp: 100 });
        const c = createTestCombatUnit({ key: 'rocket', hp: 50, maxHp: 100 });
        const html = buildSelectionSummaryHtml(stateWith([a, b, c], [a.id, b.id, c.id]));
        expect(html).toContain('3 selected');
        expect(html).toContain('Rifleman &times;2');
        expect(html).toContain('67% HP');
    });

    it('shows name, HP and owner for a single enemy', () => {
        const enemy = createTestCombatUnit({ key: 'heavy', owner: 1, hp: 300, maxHp: 600 });
        const html = buildSelectionSummaryHtml(stateWith([enemy], [enemy.id]));
        expect(html).toContain('300/600');
        expect(html).toContain('Enemy');
    });

    it('hides the command bar for an engineer/medic-only selection', () => {
        const eng = createTestCombatUnit({ key: 'engineer' });
        const medic = createTestCombatUnit({ key: 'medic' });
        updateCommandBar(stateWith([eng, medic], [eng.id, medic.id]));
        expect(document.getElementById('command-bar')!.classList.contains('hidden')).toBe(true);
        expect(document.getElementById('selection-panel')!.classList.contains('hidden')).toBe(false);
    });

    it('shows the command bar for armed units', () => {
        const rifle = createTestCombatUnit({ key: 'rifle' });
        updateCommandBar(stateWith([rifle], [rifle.id]));
        const bar = document.getElementById('command-bar')!;
        expect(bar.classList.contains('hidden')).toBe(false);
        expect(bar.querySelector('.stance-section')!.classList.contains('hidden')).toBe(false);
    });
});
