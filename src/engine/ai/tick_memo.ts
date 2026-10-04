/**
 * Per-tick memoized entity views for the AI.
 *
 * Every AI player runs against the same immutable `state.entities` object within
 * a tick, yet many AI helpers used to rescan `Object.values(state.entities)` on
 * every call. This module builds the views once per entities object (WeakMap
 * keyed, so stale views are dropped with the old state).
 *
 * Exactness contract: every list preserves `Object.values(state.entities)`
 * order, and owner/type lists keep dead entities and transported infantry
 * (unlike EntityCache.alive / unitsByOwner), so callers that previously filtered
 * `Object.values(state.entities)` can filter one of these lists with the same
 * predicate and get an identical result.
 *
 * State entities are never mutated in place by the engine; code that does
 * (some tests) must hand the AI a fresh entities object.
 */
import type { Entity, EntityId, GameState, UnitEntity } from '../types.js';
import { type EntityCache, getEnemiesOf } from '../perf.js';

export interface AIEntityIndex {
    /** Object.values(state.entities), including dead entities */
    readonly all: readonly Entity[];
    /** All entities per owner (any type, including dead and transported) */
    readonly byOwner: ReadonlyMap<number, readonly Entity[]>;
    /** UNIT entities per owner (including dead and transported) */
    readonly unitsByOwner: ReadonlyMap<number, readonly Entity[]>;
    /** All BUILDING entities (including dead) */
    readonly buildings: readonly Entity[];
    /** Living RESOURCE entities */
    readonly aliveOre: readonly Entity[];
    /** Living WELL entities */
    readonly aliveWells: readonly Entity[];
    /** Living refineries (any owner) */
    readonly aliveRefineries: readonly Entity[];
    /** Living BUILDING / RESOURCE / ROCK / WELL entities (placement obstacles) */
    readonly placementObstacles: readonly Entity[];
    /** Living units riding in a transport, keyed by transport id */
    readonly passengersByTransport: ReadonlyMap<EntityId, readonly UnitEntity[]>;
}

const EMPTY: readonly Entity[] = [];
const indexMemo = new WeakMap<object, AIEntityIndex>();

function pushTo(map: Map<number, Entity[]>, key: number, e: Entity): void {
    const list = map.get(key);
    if (list) list.push(e);
    else map.set(key, [e]);
}

export function getAIEntityIndex(state: GameState): AIEntityIndex {
    const cached = indexMemo.get(state.entities);
    if (cached) return cached;

    const all: Entity[] = [];
    const byOwner = new Map<number, Entity[]>();
    const unitsByOwner = new Map<number, Entity[]>();
    const buildings: Entity[] = [];
    const aliveOre: Entity[] = [];
    const aliveWells: Entity[] = [];
    const aliveRefineries: Entity[] = [];
    const placementObstacles: Entity[] = [];
    const passengersByTransport = new Map<EntityId, UnitEntity[]>();

    for (const e of Object.values(state.entities)) {
        all.push(e);
        pushTo(byOwner, e.owner, e);
        switch (e.type) {
            case 'UNIT': {
                pushTo(unitsByOwner, e.owner, e);
                const transportId = e.movement?.transportId;
                if (!e.dead && transportId) {
                    const riders = passengersByTransport.get(transportId);
                    if (riders) riders.push(e);
                    else passengersByTransport.set(transportId, [e]);
                }
                break;
            }
            case 'BUILDING':
                buildings.push(e);
                if (!e.dead) {
                    placementObstacles.push(e);
                    if (e.key === 'refinery') aliveRefineries.push(e);
                }
                break;
            case 'RESOURCE':
                if (!e.dead) {
                    aliveOre.push(e);
                    placementObstacles.push(e);
                }
                break;
            case 'WELL':
                if (!e.dead) {
                    aliveWells.push(e);
                    placementObstacles.push(e);
                }
                break;
            case 'ROCK':
                if (!e.dead) placementObstacles.push(e);
                break;
        }
    }

    const index: AIEntityIndex = {
        all, byOwner, unitsByOwner, buildings, aliveOre, aliveWells, aliveRefineries, placementObstacles,
        passengersByTransport
    };
    indexMemo.set(state.entities, index);
    return index;
}

/** All entities owned by a player (any type, including dead and transported). */
export function getOwnedEntities(state: GameState, playerId: number): readonly Entity[] {
    return getAIEntityIndex(state).byOwner.get(playerId) ?? EMPTY;
}

/** UNIT entities owned by a player (including dead and transported infantry). */
export function getOwnedUnits(state: GameState, playerId: number): readonly Entity[] {
    return getAIEntityIndex(state).unitsByOwner.get(playerId) ?? EMPTY;
}

/**
 * Same result as transport.getTransportPassengers(state.entities, transportId)
 * (living units whose movement.transportId matches, in entity order) without a
 * full entity scan per transport. Returns a fresh array.
 */
export function getTransportPassengersMemo(state: GameState, transportId: EntityId): UnitEntity[] {
    return getAIEntityIndex(state).passengersByTransport.get(transportId)?.slice() ?? [];
}

const enemiesMemo =new WeakMap<EntityCache, Map<GameState | undefined, Map<number, Entity[]>>>();

/**
 * Memoized getEnemiesOf: the enemy list for (cache, state, playerId) is built
 * once per tick and shared by every caller. The returned array must not be
 * mutated (copy it first if a caller needs to sort or push).
 */
export function getEnemiesOfMemo(cache: EntityCache, playerId: number, state?: GameState): Entity[] {
    let byState = enemiesMemo.get(cache);
    if (!byState) {
        byState = new Map();
        enemiesMemo.set(cache, byState);
    }
    let byPlayer = byState.get(state);
    if (!byPlayer) {
        byPlayer = new Map();
        byState.set(state, byPlayer);
    }
    let enemies = byPlayer.get(playerId);
    if (!enemies) {
        enemies = getEnemiesOf(cache, playerId, state);
        byPlayer.set(playerId, enemies);
    }
    return enemies;
}
