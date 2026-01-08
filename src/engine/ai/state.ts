import { GameState, Entity, EntityId, Vector } from '../types.js';
import { RULES, AI_CONFIG, PersonalityName } from '../../data/schemas/index.js';
import { AIPlayerState } from './types.js';
import { VENGEANCE_DECAY, VENGEANCE_PER_HIT } from './utils.js';
import { isUnit } from '../type-guards.js';

// Select a random personality from available personalities
function selectRandomPersonality(): PersonalityName {
    const personalities = Object.keys(AI_CONFIG.personalities) as PersonalityName[];
    return personalities[Math.floor(Math.random() * personalities.length)];
}

// Get the personality config for an AI player from their stored AI state
export function getPersonalityForPlayer(playerId: number) {
    const aiState = getAIState(playerId);
    return AI_CONFIG.personalities[aiState.personality] || AI_CONFIG.personalities['balanced'];
}

// Store AI states (keyed by playerId)
const aiStates: Record<number, AIPlayerState> = {};

export function getAIState(playerId: number): AIPlayerState {
    if (!aiStates[playerId]) {
        aiStates[playerId] = {
            personality: selectRandomPersonality(),
            strategy: 'buildup',
            lastStrategyChange: 0,
            attackGroup: [],
            harassGroup: [],
            defenseGroup: [],
            threatsNearBase: [],
            harvestersUnderAttack: [],
            lastThreatDetectedTick: 0,
            offensiveGroups: [],
            enemyBaseLocation: null,
            lastScoutTick: 0,
            lastProductionType: null,
            investmentPriority: 'balanced',
            economyScore: 50,
            threatLevel: 0,
            expansionTarget: null,
            peaceTicks: 0,
            lastSellTick: 0,
            enemyIntelligence: {
                lastUpdate: 0,
                unitCounts: {},
                buildingCounts: {},
                dominantArmor: 'mixed'
            },
            vengeanceScores: {},
            lastCombatTick: 0,
            stalemateDesperation: 0,
            allInStartTick: 0,
            isDoomed: false
        };
    }
    return aiStates[playerId];
}

// Reset AI state (useful for tests)
export function resetAIState(playerId?: number): void {
    if (playerId !== undefined) {
        delete aiStates[playerId];
    } else {
        for (const key in aiStates) {
            delete aiStates[key];
        }
    }
}

// Set personality for a player (useful for tests to ensure deterministic behavior)
export function setPersonalityForPlayer(playerId: number, personality: PersonalityName): void {
    const aiState = getAIState(playerId);
    aiState.personality = personality;
}

// ===== STATE UPDATE HELPERS =====

export function findBaseCenter(buildings: Entity[]): Vector {
    const conyard = buildings.find(b => b.key === 'conyard');
    if (conyard) return conyard.pos;
    if (buildings.length === 0) return new Vector(300, 300);

    let sumX = 0, sumY = 0;
    for (const b of buildings) {
        sumX += b.pos.x;
        sumY += b.pos.y;
    }
    return new Vector(sumX / buildings.length, sumY / buildings.length);
}

export function updateEnemyBaseLocation(aiState: AIPlayerState, enemyBuildings: Entity[]): void {
    if (enemyBuildings.length === 0) return;

    // Find enemy production center (conyard > factory > any building)
    const conyard = enemyBuildings.find(b => b.key === 'conyard');
    if (conyard) {
        aiState.enemyBaseLocation = conyard.pos;
        return;
    }

    const factory = enemyBuildings.find(b => b.key === 'factory');
    if (factory) {
        aiState.enemyBaseLocation = factory.pos;
        return;
    }

    // Fallback to center of enemy buildings
    let sumX = 0, sumY = 0;
    for (const b of enemyBuildings) {
        sumX += b.pos.x;
        sumY += b.pos.y;
    }
    aiState.enemyBaseLocation = new Vector(sumX / enemyBuildings.length, sumY / enemyBuildings.length);
}

export function updateEnemyIntelligence(aiState: AIPlayerState, enemies: Entity[], tick: number): void {
    // Only update every 300 ticks (5 seconds)
    if (tick - aiState.enemyIntelligence.lastUpdate < 300) return;

    const unitCounts: Record<string, number> = {};
    const buildingCounts: Record<string, number> = {};
    let infantryCount = 0;
    let lightCount = 0;
    let heavyCount = 0;

    for (const e of enemies) {
        if (e.type === 'UNIT') {
            unitCounts[e.key] = (unitCounts[e.key] || 0) + 1;

            // Categorize by armor type
            const data = RULES.units?.[e.key];
            if (data) {
                if (data.armor === 'infantry') infantryCount++;
                else if (data.armor === 'light') lightCount++;
                else if (data.armor === 'heavy' || data.armor === 'medium') heavyCount++;
            }
        } else if (e.type === 'BUILDING') {
            buildingCounts[e.key] = (buildingCounts[e.key] || 0) + 1;
        }
    }

    // Determine dominant armor type
    let dominantArmor: 'infantry' | 'light' | 'heavy' | 'mixed' = 'mixed';
    const total = infantryCount + lightCount + heavyCount;
    if (total > 0) {
        if (infantryCount > total * 0.6) dominantArmor = 'infantry';
        else if (heavyCount > total * 0.4) dominantArmor = 'heavy';
        else if (lightCount > total * 0.4) dominantArmor = 'light';
    }

    aiState.enemyIntelligence = {
        lastUpdate: tick,
        unitCounts,
        buildingCounts,
        dominantArmor
    };
}

export function updateVengeance(
    state: GameState,
    playerId: number,
    aiState: AIPlayerState,
    myEntities: Entity[]
): void {
    // Apply decay to existing vengeance scores
    for (const pid in aiState.vengeanceScores) {
        aiState.vengeanceScores[pid] *= VENGEANCE_DECAY;
        // Clean up negligible scores
        if (aiState.vengeanceScores[pid] < 0.1) {
            delete aiState.vengeanceScores[pid];
        }
    }

    // Track damage from attackers
    for (const entity of myEntities) {
        if (isUnit(entity) && entity.combat.lastAttackerId) {
            const attacker = state.entities[entity.combat.lastAttackerId];
            if (attacker && attacker.owner !== playerId && attacker.owner !== -1) {
                const attackerOwner = attacker.owner;
                aiState.vengeanceScores[attackerOwner] =
                    (aiState.vengeanceScores[attackerOwner] || 0) + VENGEANCE_PER_HIT;
            }
        }
    }
}

export function getGroupCenter(unitIds: EntityId[], entities: Record<EntityId, Entity>): Vector | null {
    let sumX = 0, sumY = 0, count = 0;
    for (const id of unitIds) {
        const unit = entities[id];
        if (unit && !unit.dead) {
            sumX += unit.pos.x;
            sumY += unit.pos.y;
            count++;
        }
    }
    if (count === 0) return null;
    return new Vector(sumX / count, sumY / count);
}
