import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AI_IMPLEMENTATION_ID } from '../../src/engine/ai/index.js';
import {
    applySkirmishSettingsToUI,
    collectSkirmishSettingsFromUI,
    loadSkirmishSettingsFromStorage,
    saveSkirmishSettingsToStorage,
    SKIRMISH_SETTINGS_STORAGE_KEY
} from '../../src/skirmish/persistence.js';

function setupDom() {
    document.body.innerHTML = `
        <div class="player-slot">
            <select class="player-type">
                <option value="human">Human</option>
                <option value="dummy">Dummy</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
                <option value="none">None</option>
            </select>
            <select class="ai-implementation">
                <option value="classic">Classic</option>
                <option value="eco_tank_all_in">Eco Tank All In</option>
            </select>
        </div>
        <div class="player-slot">
            <select class="player-type">
                <option value="human">Human</option>
                <option value="dummy">Dummy</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
                <option value="none">None</option>
            </select>
            <select class="ai-implementation">
                <option value="classic">Classic</option>
                <option value="eco_tank_all_in">Eco Tank All In</option>
            </select>
        </div>
        <div class="player-slot">
            <select class="player-type">
                <option value="human">Human</option>
                <option value="dummy">Dummy</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
                <option value="none">None</option>
            </select>
            <select class="ai-implementation">
                <option value="classic">Classic</option>
                <option value="eco_tank_all_in">Eco Tank All In</option>
            </select>
        </div>
        <select id="map-size">
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
            <option value="huge">Huge</option>
        </select>
        <select id="resource-density">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
        </select>
        <select id="rock-density">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
        </select>
    `;
}

describe('Skirmish menu persistence', () => {
    beforeEach(() => {
        setupDom();
    });

    it('applies saved player type, AI implementation, and difficulty settings', () => {
        const storage = {
            getItem: vi.fn(() =>
                JSON.stringify({
                    players: [
                        { type: 'none', aiImplementationId: 'eco_tank_all_in' },
                        { type: 'human', aiImplementationId: 'classic' },
                        { type: 'hard', aiImplementationId: 'eco_tank_all_in' }
                    ],
                    mapSize: 'huge',
                    resourceDensity: 'high',
                    rockDensity: 'low'
                })
            )
        };

        const settings = loadSkirmishSettingsFromStorage(storage, 3);
        expect(settings).not.toBeNull();
        applySkirmishSettingsToUI(settings!, document);

        const slotTypes = Array.from(document.querySelectorAll('.player-type')) as HTMLSelectElement[];
        const slotAis = Array.from(document.querySelectorAll('.ai-implementation')) as HTMLSelectElement[];

        expect(slotTypes[0].value).toBe('none');
        expect(slotTypes[1].value).toBe('human');
        expect(slotTypes[2].value).toBe('hard');
        expect(slotAis[0].value).toBe('eco_tank_all_in');
        expect(slotAis[2].value).toBe('eco_tank_all_in');
        expect((document.getElementById('map-size') as HTMLSelectElement).value).toBe('huge');
        expect((document.getElementById('resource-density') as HTMLSelectElement).value).toBe('high');
        expect((document.getElementById('rock-density') as HTMLSelectElement).value).toBe('low');
    });

    it('falls back to default AI implementation for unknown saved implementation ids', () => {
        const storage = {
            getItem: vi.fn(() =>
                JSON.stringify({
                    players: [
                        { type: 'medium', aiImplementationId: 'missing_ai' },
                        { type: 'medium', aiImplementationId: 'eco_tank_all_in' },
                        { type: 'none', aiImplementationId: 'classic' }
                    ]
                })
            )
        };

        const settings = loadSkirmishSettingsFromStorage(storage, 3);
        expect(settings).not.toBeNull();
        applySkirmishSettingsToUI(settings!, document);

        const slotAis = Array.from(document.querySelectorAll('.ai-implementation')) as HTMLSelectElement[];
        expect(slotAis[0].value).toBe(DEFAULT_AI_IMPLEMENTATION_ID);
        expect(slotAis[1].value).toBe('eco_tank_all_in');
    });

    it('collects and saves current UI settings', () => {
        const slotTypes = Array.from(document.querySelectorAll('.player-type')) as HTMLSelectElement[];
        const slotAis = Array.from(document.querySelectorAll('.ai-implementation')) as HTMLSelectElement[];
        slotTypes[0].value = 'none';
        slotTypes[1].value = 'human';
        slotTypes[2].value = 'hard';
        slotAis[0].value = 'eco_tank_all_in';
        slotAis[2].value = 'classic';
        (document.getElementById('map-size') as HTMLSelectElement).value = 'large';
        (document.getElementById('resource-density') as HTMLSelectElement).value = 'low';
        (document.getElementById('rock-density') as HTMLSelectElement).value = 'high';

        const storage = {
            setItem: vi.fn()
        };

        const settings = collectSkirmishSettingsFromUI(document);
        saveSkirmishSettingsToStorage(storage, settings);

        expect(storage.setItem).toHaveBeenCalledTimes(1);
        const [key, value] = storage.setItem.mock.calls[0];
        expect(key).toBe(SKIRMISH_SETTINGS_STORAGE_KEY);

        const saved = JSON.parse(value as string) as typeof settings;
        expect(saved.players[0].type).toBe('none');
        expect(saved.players[0].aiImplementationId).toBe('eco_tank_all_in');
        expect(saved.players[1].type).toBe('human');
        expect(saved.players[2].type).toBe('hard');
        expect(saved.mapSize).toBe('large');
        expect(saved.resourceDensity).toBe('low');
        expect(saved.rockDensity).toBe('high');
    });
});
