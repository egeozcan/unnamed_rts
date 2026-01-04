import fs from 'node:fs';
import path from 'node:path';
import { GameState, Vector, EntityId } from '../engine/types';
import { tick } from '../engine/reducer';

// Helper to parse arguments
function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        input: '',
        output: '',
        ticks: 0,
        removePlayerIds: [] as number[],
        removeUnitPlayerIds: [] as number[],
        removeUnitTypes: [] as string[],
        removeUnitNear: [] as { id: string, dist: number }[],
        removeUnitFurther: [] as { id: string, dist: number }[],
        removeBuildingPlayerIds: [] as number[],
        removeBuildingTypes: [] as string[],
        removeBuildingNear: [] as { id: string, dist: number }[],
        removeBuildingFurther: [] as { id: string, dist: number }[],
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--input') {
            config.input = args[++i];
        } else if (arg === '--output') {
            config.output = args[++i];
        } else if (arg === '--ticks') {
            config.ticks = parseInt(args[++i], 10);
        } else if (arg === '--remove-player') {
            config.removePlayerIds.push(parseInt(args[++i], 10));
        } else if (arg === '--remove-unit-player') {
            config.removeUnitPlayerIds.push(parseInt(args[++i], 10));
        } else if (arg === '--remove-unit-type') {
            config.removeUnitTypes.push(args[++i]);
        } else if (arg === '--remove-unit-near') {
            const parts = args[++i].split(',');
            config.removeUnitNear.push({ id: parts[0], dist: parseFloat(parts[1]) });
        } else if (arg === '--remove-unit-further') {
            const parts = args[++i].split(',');
            config.removeUnitFurther.push({ id: parts[0], dist: parseFloat(parts[1]) });
        } else if (arg === '--remove-building-player') {
            config.removeBuildingPlayerIds.push(parseInt(args[++i], 10));
        } else if (arg === '--remove-building-type') {
            config.removeBuildingTypes.push(args[++i]);
        } else if (arg === '--remove-building-near') {
            const parts = args[++i].split(',');
            config.removeBuildingNear.push({ id: parts[0], dist: parseFloat(parts[1]) });
        } else if (arg === '--remove-building-further') {
            const parts = args[++i].split(',');
            config.removeBuildingFurther.push({ id: parts[0], dist: parseFloat(parts[1]) });
        } else if (arg === '--help') {
            console.log(`
Usage:
  --input <file>                Input JSON file path
  --output <file>               Output JSON file path (default: overwrite input)
  --ticks <number>              Number of ticks to advance
  --remove-player <id>          Remove player ID and all their entities
  --remove-unit-player <id>     Remove units belonging to player ID
  --remove-unit-type <type>     Remove units of specific type (e.g. harvester)
  --remove-unit-near <id>,<d>   Remove units within distance d of entity ID
  --remove-unit-further <id>,<d> Remove units further than distance d from entity ID
  --remove-building-player <id> Remove buildings belonging to player ID
  --remove-building-type <type> Remove buildings of specific type
  --remove-building-near <id>,<d> Remove buildings within distance d of entity ID
  --remove-building-further <id>,<d> Remove buildings further than distance d from entity ID
            `);
            process.exit(0);
        }
    }
    return config;
}

// Distance helper since we might be working with raw JSON objects or classes
function getDistance(a: { pos: { x: number, y: number } }, b: { pos: { x: number, y: number } }): number {
    const dx = a.pos.x - b.pos.x;
    const dy = a.pos.y - b.pos.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function main() {
    const config = parseArgs();

    if (!config.input) {
        console.error('Error: --input is required');
        process.exit(1);
    }

    const inputPath = path.resolve(config.input);
    if (!fs.existsSync(inputPath)) {
        console.error(`Error: File not found at ${inputPath}`);
        process.exit(1);
    }

    console.log(`Loading state from ${inputPath}...`);
    const rawData = fs.readFileSync(inputPath, 'utf8');
    let state: GameState = JSON.parse(rawData);

    // Rehydrate Vectors if needed (optional if logic handles plain objects)
    // The engine's Vector methods won't exist on plain objects from JSON.
    // However, the 'tick' function and others might rely on Vector methods.
    // We should probably do a quick pass to rehydrate Vectors for safety if 'tick' is called.
    // BUT checking 'tick' implementation in reducer.ts, it calls 'updateEntities' etc.
    // 'types.ts' defines Vector class.
    // Let's do a simple rehydration helper.

    function rehydrateVectors(obj: unknown): unknown {
        if (!obj) return obj;
        if (typeof obj === 'object' && obj !== null) {
            const record = obj as Record<string, unknown>;
            if (typeof record.x === 'number' && typeof record.y === 'number' && Object.keys(record).length === 2) {
                return new Vector(record.x, record.y);
            }
            if (Array.isArray(obj)) {
                return obj.map(rehydrateVectors);
            }
            const newObj: Record<string, unknown> = {};
            for (const key in record) {
                newObj[key] = rehydrateVectors(record[key]);
            }
            return newObj;
        }
        return obj;
    }

    // Only rehydrate if we are going to tick, because tick expects Vectors with methods.
    // But removals also need to check distances, so having Vectors might be handy or we use our helper.
    // Wait, state.entities has objects that have 'pos: Vector'.
    // If we parse JSON, 'pos' is just {x,y}.
    // If 'tick' calls 'pos.add()', it will crash.
    // So we MUST rehydrate.

    console.log('Rehydrating state...');
    state = rehydrateVectors(state) as GameState;

    // === APPLY REMOVALS ===

    // 1. Remove Players
    if (config.removePlayerIds.length > 0) {
        config.removePlayerIds.forEach(pid => {
            console.log(`Removing player ${pid}...`);
            delete state.players[pid];
        });

        // Remove all entities owned by these players
        const entitiesToRemove = Object.values(state.entities)
            .filter(e => config.removePlayerIds.includes(e.owner))
            .map(e => e.id);

        entitiesToRemove.forEach(id => delete state.entities[id]);
        console.log(`Removed ${entitiesToRemove.length} entities for removed players.`);
    }

    // 2. Remove Units
    const unitIdsToRemove: EntityId[] = [];

    // By Player
    if (config.removeUnitPlayerIds.length > 0) {
        Object.values(state.entities).forEach(e => {
            if (e.type === 'UNIT' && config.removeUnitPlayerIds.includes(e.owner)) {
                unitIdsToRemove.push(e.id);
            }
        });
    }

    // By Type
    if (config.removeUnitTypes.length > 0) {
        Object.values(state.entities).forEach(e => {
            if (e.type === 'UNIT' && config.removeUnitTypes.includes(e.key)) {
                unitIdsToRemove.push(e.id);
            }
        });
    }

    // Near
    config.removeUnitNear.forEach(check => {
        const target = state.entities[check.id];
        if (!target) {
            console.warn(`Warning: Target entity ${check.id} not found for near check.`);
            return;
        }
        Object.values(state.entities).forEach(e => {
            if (e.type === 'UNIT' && e.id !== check.id) {
                if (getDistance(e, target) <= check.dist) {
                    unitIdsToRemove.push(e.id);
                }
            }
        });
    });

    // Further
    config.removeUnitFurther.forEach(check => {
        const target = state.entities[check.id];
        if (!target) {
            console.warn(`Warning: Target entity ${check.id} not found for further check.`);
            return;
        }
        Object.values(state.entities).forEach(e => {
            if (e.type === 'UNIT' && e.id !== check.id) {
                if (getDistance(e, target) > check.dist) {
                    unitIdsToRemove.push(e.id);
                }
            }
        });
    });

    // 3. Remove Buildings
    const buildingIdsToRemove: EntityId[] = [];

    // By Player
    if (config.removeBuildingPlayerIds.length > 0) {
        Object.values(state.entities).forEach(e => {
            if (e.type === 'BUILDING' && config.removeBuildingPlayerIds.includes(e.owner)) {
                buildingIdsToRemove.push(e.id);
            }
        });
    }

    // By Type
    if (config.removeBuildingTypes.length > 0) {
        Object.values(state.entities).forEach(e => {
            if (e.type === 'BUILDING' && config.removeBuildingTypes.includes(e.key)) {
                buildingIdsToRemove.push(e.id);
            }
        });
    }

    // Near
    config.removeBuildingNear.forEach(check => {
        const target = state.entities[check.id];
        if (!target) {
            console.warn(`Warning: Target entity ${check.id} not found for near check.`);
            return;
        }
        Object.values(state.entities).forEach(e => {
            if (e.type === 'BUILDING' && e.id !== check.id) {
                if (getDistance(e, target) <= check.dist) {
                    buildingIdsToRemove.push(e.id);
                }
            }
        });
    });

    // Further
    config.removeBuildingFurther.forEach(check => {
        const target = state.entities[check.id];
        if (!target) {
            console.warn(`Warning: Target entity ${check.id} not found for further check.`);
            return;
        }
        Object.values(state.entities).forEach(e => {
            if (e.type === 'BUILDING' && e.id !== check.id) {
                if (getDistance(e, target) > check.dist) {
                    buildingIdsToRemove.push(e.id);
                }
            }
        });
    });

    // Execute Removals
    const uniqueUnitIds = [...new Set(unitIdsToRemove)];
    uniqueUnitIds.forEach(id => {
        if (state.entities[id]) delete state.entities[id];
    });
    if (uniqueUnitIds.length > 0) console.log(`Removed ${uniqueUnitIds.length} units.`);

    const uniqueBuildingIds = [...new Set(buildingIdsToRemove)];
    uniqueBuildingIds.forEach(id => {
        if (state.entities[id]) delete state.entities[id];
    });
    if (uniqueBuildingIds.length > 0) console.log(`Removed ${uniqueBuildingIds.length} buildings.`);


    // === ADVANCE SIMULATION ===
    if (config.ticks > 0) {
        console.log(`Advancing simulation by ${config.ticks} ticks...`);
        // We likely need to set 'running' to true for tick to do anything, 
        // or tick might require it. Logic in reducer.ts: "if (!state.running) return state;"
        // So we must force running = true temporarily.
        const wasRunning = state.running;
        state = { ...state, running: true };

        for (let i = 0; i < config.ticks; i++) {
            state = tick(state);
            if (i % 100 === 0 && i > 0) process.stdout.write('.');
        }
        console.log('\nSimulation done.');

        state = { ...state, running: wasRunning };
    }

    // === SAVE ===
    const outputPath = config.output ? path.resolve(config.output) : inputPath;
    console.log(`Saving state to ${outputPath}...`);
    // When saving, we might want to strip Vector class methods (JSON.stringify does this automatically)
    fs.writeFileSync(outputPath, JSON.stringify(state, null, 2));
    console.log('Done.');
}

main();
