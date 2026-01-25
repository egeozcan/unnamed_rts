/**
 * Trigger condition parser and evaluator for advance-until debugging.
 *
 * Parses trigger condition strings and evaluates them against game state
 * to support conditional advancement of game simulation.
 */

import { GameState } from '../../engine/types.js';
import { getAIState } from '../../engine/ai/state.js';

// ============================================================================
// Type Definitions
// ============================================================================

export type TriggerOperator = '<' | '>' | '<=' | '>=' | '==';

export type Trigger =
    | { type: 'dead'; entityId: string }
    | { type: 'hp'; entityId: string; operator: TriggerOperator; value: number }
    | { type: 'tick'; operator: TriggerOperator; value: number }
    | { type: 'credits'; playerId: number; operator: TriggerOperator; value: number }
    | { type: 'strategy'; playerId: number; operator: '=='; value: string }
    | { type: 'count'; playerId: number; entityType: string; operator: TriggerOperator; value: number }
    | { type: 'player-dead'; playerId: number }
    | { type: 'threat'; playerId: number; operator: TriggerOperator; value: number }
    | { type: 'area'; x: number; y: number; radius: number; entityId: string }
    | { type: 'or'; conditions: Trigger[] };

// ============================================================================
// Parser
// ============================================================================

/**
 * Regular expression patterns for each trigger type.
 */
const PATTERNS = {
    dead: /^dead\s+(\S+)$/,
    hp: /^hp\s+(\S+)\s+(<|>|<=|>=|==)\s+(\d+)%$/,
    tick: /^tick\s+(<|>|<=|>=|==)\s+(\d+)$/,
    credits: /^credits\s+(\d+)\s+(<|>|<=|>=|==)\s+(\d+)$/,
    strategy: /^strategy\s+(\d+)\s+(==)\s+(\S+)$/,
    count: /^count\s+(\d+)\s+(\S+)\s+(<|>|<=|>=|==)\s+(\d+)$/,
    playerDead: /^player\s+(\d+)\s+dead$/,
    threat: /^threat\s+(\d+)\s+(<|>|<=|>=|==)\s+(\d+)$/,
    area: /^area\s+(\d+),(\d+),(\d+)\s+has\s+(\S+)$/
};

/**
 * Parse a trigger condition string into a Trigger object.
 *
 * @param input - The trigger condition string
 * @returns The parsed Trigger object
 * @throws Error if the input cannot be parsed
 */
export function parseTrigger(input: string): Trigger {
    const trimmed = input.trim();

    if (!trimmed) {
        throw new Error('Empty trigger string');
    }

    // Handle OR conditions first
    if (trimmed.includes(' or ')) {
        const parts = trimmed.split(' or ');
        const conditions = parts.map(part => parseTrigger(part.trim()));
        return { type: 'or', conditions };
    }

    // Try each pattern
    let match: RegExpMatchArray | null;

    // dead <id>
    match = trimmed.match(PATTERNS.dead);
    if (match) {
        return { type: 'dead', entityId: match[1] };
    }

    // hp <id> <op> <percent>%
    match = trimmed.match(PATTERNS.hp);
    if (match) {
        return {
            type: 'hp',
            entityId: match[1],
            operator: match[2] as TriggerOperator,
            value: parseInt(match[3], 10)
        };
    }

    // tick <op> <n>
    match = trimmed.match(PATTERNS.tick);
    if (match) {
        return {
            type: 'tick',
            operator: match[1] as TriggerOperator,
            value: parseInt(match[2], 10)
        };
    }

    // credits <player> <op> <amount>
    match = trimmed.match(PATTERNS.credits);
    if (match) {
        return {
            type: 'credits',
            playerId: parseInt(match[1], 10),
            operator: match[2] as TriggerOperator,
            value: parseInt(match[3], 10)
        };
    }

    // strategy <player> == <strategy>
    match = trimmed.match(PATTERNS.strategy);
    if (match) {
        return {
            type: 'strategy',
            playerId: parseInt(match[1], 10),
            operator: match[2] as '==',
            value: match[3]
        };
    }

    // count <player> <type> <op> <n>
    match = trimmed.match(PATTERNS.count);
    if (match) {
        return {
            type: 'count',
            playerId: parseInt(match[1], 10),
            entityType: match[2],
            operator: match[3] as TriggerOperator,
            value: parseInt(match[4], 10)
        };
    }

    // player <id> dead
    match = trimmed.match(PATTERNS.playerDead);
    if (match) {
        return {
            type: 'player-dead',
            playerId: parseInt(match[1], 10)
        };
    }

    // threat <player> <op> <level>
    match = trimmed.match(PATTERNS.threat);
    if (match) {
        return {
            type: 'threat',
            playerId: parseInt(match[1], 10),
            operator: match[2] as TriggerOperator,
            value: parseInt(match[3], 10)
        };
    }

    // area <x>,<y>,<radius> has <id>
    match = trimmed.match(PATTERNS.area);
    if (match) {
        return {
            type: 'area',
            x: parseInt(match[1], 10),
            y: parseInt(match[2], 10),
            radius: parseInt(match[3], 10),
            entityId: match[4]
        };
    }

    throw new Error(`Invalid trigger format: "${input}"`);
}

// ============================================================================
// Evaluator
// ============================================================================

/**
 * Compare two numbers using the specified operator.
 */
function compareNumbers(left: number, operator: TriggerOperator, right: number): boolean {
    switch (operator) {
        case '<': return left < right;
        case '>': return left > right;
        case '<=': return left <= right;
        case '>=': return left >= right;
        case '==': return left === right;
    }
}

/**
 * Evaluate a trigger condition against the current game state.
 *
 * @param trigger - The trigger to evaluate
 * @param state - The current game state
 * @returns true if the trigger condition is met
 */
export function evaluateTrigger(trigger: Trigger, state: GameState): boolean {
    switch (trigger.type) {
        case 'dead':
            return evaluateDeadTrigger(trigger, state);

        case 'hp':
            return evaluateHpTrigger(trigger, state);

        case 'tick':
            return compareNumbers(state.tick, trigger.operator, trigger.value);

        case 'credits':
            return evaluateCreditsTrigger(trigger, state);

        case 'strategy':
            return evaluateStrategyTrigger(trigger, state);

        case 'count':
            return evaluateCountTrigger(trigger, state);

        case 'player-dead':
            return evaluatePlayerDeadTrigger(trigger, state);

        case 'threat':
            return evaluateThreatTrigger(trigger, state);

        case 'area':
            return evaluateAreaTrigger(trigger, state);

        case 'or':
            return evaluateOrTrigger(trigger, state);
    }
}

/**
 * Evaluate 'dead' trigger - true if entity doesn't exist or is dead.
 */
function evaluateDeadTrigger(
    trigger: { type: 'dead'; entityId: string },
    state: GameState
): boolean {
    const entity = state.entities[trigger.entityId];
    return !entity || entity.dead;
}

/**
 * Evaluate 'hp' trigger - check entity HP percentage.
 */
function evaluateHpTrigger(
    trigger: { type: 'hp'; entityId: string; operator: TriggerOperator; value: number },
    state: GameState
): boolean {
    const entity = state.entities[trigger.entityId];
    if (!entity) {
        return false;
    }

    const hpPercent = (entity.hp / entity.maxHp) * 100;
    return compareNumbers(hpPercent, trigger.operator, trigger.value);
}

/**
 * Evaluate 'credits' trigger - check player credits.
 */
function evaluateCreditsTrigger(
    trigger: { type: 'credits'; playerId: number; operator: TriggerOperator; value: number },
    state: GameState
): boolean {
    const player = state.players[trigger.playerId];
    if (!player) {
        return false;
    }

    return compareNumbers(player.credits, trigger.operator, trigger.value);
}

/**
 * Evaluate 'strategy' trigger - check AI strategy.
 */
function evaluateStrategyTrigger(
    trigger: { type: 'strategy'; playerId: number; operator: '=='; value: string },
    _state: GameState
): boolean {
    const aiState = getAIState(trigger.playerId);
    return aiState.strategy === trigger.value;
}

/**
 * Evaluate 'count' trigger - count entities by type or key.
 */
function evaluateCountTrigger(
    trigger: { type: 'count'; playerId: number; entityType: string; operator: TriggerOperator; value: number },
    state: GameState
): boolean {
    let count = 0;

    for (const entity of Object.values(state.entities)) {
        // Skip dead entities
        if (entity.dead) {
            continue;
        }

        // Skip entities not owned by the specified player
        if (entity.owner !== trigger.playerId) {
            continue;
        }

        // Match by type (UNIT, BUILDING) or by key (harvester, refinery, etc.)
        if (entity.type === trigger.entityType || entity.key === trigger.entityType) {
            count++;
        }
    }

    return compareNumbers(count, trigger.operator, trigger.value);
}

/**
 * Evaluate 'player-dead' trigger - check if player has no alive units or buildings.
 */
function evaluatePlayerDeadTrigger(
    trigger: { type: 'player-dead'; playerId: number },
    state: GameState
): boolean {
    for (const entity of Object.values(state.entities)) {
        // Only check units and buildings
        if (entity.type !== 'UNIT' && entity.type !== 'BUILDING') {
            continue;
        }

        // Skip dead entities
        if (entity.dead) {
            continue;
        }

        // If any alive unit/building belongs to the player, they're not dead
        if (entity.owner === trigger.playerId) {
            return false;
        }
    }

    return true;
}

/**
 * Evaluate 'threat' trigger - check AI threat level.
 */
function evaluateThreatTrigger(
    trigger: { type: 'threat'; playerId: number; operator: TriggerOperator; value: number },
    _state: GameState
): boolean {
    const aiState = getAIState(trigger.playerId);
    return compareNumbers(aiState.threatLevel, trigger.operator, trigger.value);
}

/**
 * Evaluate 'area' trigger - check if entity is within radius of point.
 */
function evaluateAreaTrigger(
    trigger: { type: 'area'; x: number; y: number; radius: number; entityId: string },
    state: GameState
): boolean {
    const entity = state.entities[trigger.entityId];
    if (!entity) {
        return false;
    }

    // Calculate Euclidean distance
    const dx = entity.pos.x - trigger.x;
    const dy = entity.pos.y - trigger.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    return distance <= trigger.radius;
}

/**
 * Evaluate 'or' trigger - true if any condition is met.
 */
function evaluateOrTrigger(
    trigger: { type: 'or'; conditions: Trigger[] },
    state: GameState
): boolean {
    for (const condition of trigger.conditions) {
        if (evaluateTrigger(condition, state)) {
            return true;
        }
    }
    return false;
}
