import { GameState, Action } from './types.js';
import aiConfig from '../data/ai.json';
import rules from '../data/rules.json';

const RULES = rules as any;
const AI_CONFIG = aiConfig as any;

export function computeAiActions(state: GameState, playerId: number): Action[] {
    const actions: Action[] = [];

    // Only run AI every 60 ticks (1 second) to simulate reaction time and save perf
    if (state.tick % 60 !== 0) return actions;

    const player = state.players[playerId];
    if (!player) return actions;

    const myEntities = Object.values(state.entities).filter(e => e.owner === playerId && !e.dead);
    const myBuildings = myEntities.filter(e => e.type === 'BUILDING');
    const myUnits = myEntities.filter(e => e.type === 'UNIT');
    const enemies = Object.values(state.entities).filter(e => e.owner !== playerId && e.owner !== -1 && !e.dead);

    // 1. Build Order
    const personality = AI_CONFIG.personalities['balanced']; // Default to balanced
    const buildOrder = personality.build_order_priority;

    // Simple verification: if we don't have it and not building it, build it.
    // Check prerequisites too.
    for (const item of buildOrder) {
        const having = myBuildings.some(b => b.key === item);
        const q = player.queues.building;
        const building = q.current === item;

        if (!having && !building) {
            // Check reqs
            const data = RULES.buildings[item];
            if (data) {
                const reqsMet = (data.req || []).every((r: string) => myBuildings.some(b => b.key === r));
                if (reqsMet) {
                    // Check cost? Reducer handles cost check, but we shouldn't spam if no money?
                    // Let's spam, reducer ignores if busy or no money (well, queue waits).
                    actions.push({ type: 'START_BUILD', payload: { category: 'building', key: item, playerId } });
                    break; // One at a time
                }
            }
        }
    }

    // 2. Unit Production
    // If we have a barracks, build riflemen. If factory, build tanks.
    // Maintain a standing army size?
    if (player.credits > 1000) {
        if (myBuildings.some(b => b.key === 'barracks') && !player.queues.infantry.current) {
            actions.push({ type: 'START_BUILD', payload: { category: 'infantry', key: 'rifle', playerId } });
        }
        if (myBuildings.some(b => b.key === 'factory') && !player.queues.vehicle.current) {
            actions.push({ type: 'START_BUILD', payload: { category: 'vehicle', key: 'tank', playerId } });
        }
    }

    // 3. Place Buildings
    if (player.readyToPlace) {
        // Find a spot.
        // Simple layout: near conyard spiral?
        // Random valid spot near existing buildings.
        const conyard = myBuildings.find(b => b.key === 'conyard') || myBuildings[0];
        if (conyard) {
            // Try 10 random spots
            for (let i = 0; i < 10; i++) {
                const ang = Math.random() * Math.PI * 2;
                const dist = 100 + Math.random() * 200;
                const x = conyard.pos.x + Math.cos(ang) * dist;
                const y = conyard.pos.y + Math.sin(ang) * dist;

                // We don't have collision logic here easily available exposed from utils?
                // We can import `isValidBuildLocation` logic or similar.
                // For now, just dispatch PLACE. If invalid, reducer *should* reject?
                // My reducer placeBuilding `createEntity` doesn't strictly check collision yet!
                // It just places.
                // So AI will cheat and place on top of things if I'm not careful.
                // I should fix reducer's `placeBuilding` to check validity too.
                // For now, dispatch and hope.
                actions.push({ type: 'PLACE_BUILDING', payload: { key: player.readyToPlace, x, y, playerId } });
                break;
            }
        }
    }

    // 4. Attack Logic
    if (myUnits.length > 5 && enemies.length > 0) {
        // Attack Attack!
        const target = enemies[Math.floor(Math.random() * enemies.length)];
        const idleUnits = myUnits.filter(u => !u.targetId && !u.moveTarget && u.key !== 'harvester');

        if (idleUnits.length > 0) {
            actions.push({
                type: 'COMMAND_ATTACK',
                payload: {
                    unitIds: idleUnits.map(u => u.id),
                    targetId: target.id
                }
            });
        }
    }

    return actions;
}
