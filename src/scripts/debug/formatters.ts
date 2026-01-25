/**
 * Formatters for debug query output.
 *
 * Provides human-readable formatting for:
 * - AI player status
 * - Unit details
 * - Entity search results
 * - Group information
 * - Debug events
 */

import { GameState, UnitEntity } from '../../engine/types.js';
import { getAIState } from '../../engine/ai/state.js';
import { isUnit, isHarvester } from '../../engine/type-guards.js';
import type { DebugEvent } from '../../engine/debug/schemas.js';

// ============================================================================
// Status Formatter
// ============================================================================

/**
 * Format AI status for a player.
 * Displays strategy, economy, threat, and group information.
 */
export function formatStatus(state: GameState, playerId: number): string {
    const player = state.players[playerId];
    if (!player) {
        return `Player ${playerId} not found`;
    }

    const lines: string[] = [];

    // Player header
    const playerType = player.isAi ? `AI (${player.difficulty})` : 'Human';
    lines.push(`=== Player ${playerId}: ${playerType} ===`);
    lines.push('');

    // Economy
    lines.push(`Credits: ${player.credits}`);
    lines.push(`Power: ${player.usedPower} / ${player.maxPower}`);
    lines.push('');

    // Only show AI-specific info for AI players
    if (player.isAi) {
        const aiState = getAIState(playerId);

        // Strategy
        lines.push(`Strategy: ${aiState.strategy} (changed at tick ${aiState.lastStrategyChange})`);
        lines.push(`Investment: ${aiState.investmentPriority}`);
        lines.push('');

        // Threat and economy
        lines.push(`Threat: ${aiState.threatLevel}`);
        lines.push(`Economy: ${aiState.economyScore}`);
        lines.push(`Desperation: ${aiState.stalemateDesperation}`);
        lines.push(`Doomed: ${aiState.isDoomed}`);
        lines.push('');
    }

    // Entity counts
    const entities = Object.values(state.entities);
    const playerEntities = entities.filter(e => e.owner === playerId && !e.dead);
    const units = playerEntities.filter(e => e.type === 'UNIT');
    const buildings = playerEntities.filter(e => e.type === 'BUILDING');
    const harvesters = playerEntities.filter(e => isHarvester(e));

    lines.push(`Units: ${units.length}`);
    lines.push(`Buildings: ${buildings.length}`);
    lines.push(`Harvesters: ${harvesters.length}`);
    lines.push('');

    // Only show group info for AI players
    if (player.isAi) {
        const aiState = getAIState(playerId);

        // Offensive groups
        if (aiState.offensiveGroups.length > 0) {
            lines.push('Offensive Groups:');
            for (const group of aiState.offensiveGroups) {
                lines.push(`  ${group.id}: ${group.unitIds.length} units, ${group.status}`);
            }
            lines.push('');
        }

        // Vengeance scores (only show > 1)
        const significantVengeance = Object.entries(aiState.vengeanceScores)
            .filter(([_, score]) => score >= 1)
            .map(([pid, score]) => `Player ${pid}: ${score}`);

        if (significantVengeance.length > 0) {
            lines.push('Vengeance:');
            for (const entry of significantVengeance) {
                lines.push(`  ${entry}`);
            }
        }
    }

    return lines.join('\n');
}

// ============================================================================
// Unit Formatter
// ============================================================================

/**
 * Format detailed unit information.
 */
export function formatUnit(state: GameState, entityId: string): string {
    const entity = state.entities[entityId];
    if (!entity) {
        return `Entity ${entityId} not found`;
    }

    const lines: string[] = [];

    // Header
    lines.push(`=== ${entityId} (${entity.key}) ===`);
    lines.push('');

    // Basic info
    lines.push(`Type: ${entity.type}`);
    lines.push(`Owner: ${entity.owner}`);
    const hpPercent = Math.round((entity.hp / entity.maxHp) * 100);
    lines.push(`HP: ${entity.hp}/${entity.maxHp} (${hpPercent}%)`);
    lines.push(`Position: (${Math.round(entity.pos.x)}, ${Math.round(entity.pos.y)})`);
    lines.push(`Dead: ${entity.dead}`);
    lines.push('');

    // Unit-specific info
    if (isUnit(entity)) {
        const unit = entity as UnitEntity;

        // Movement
        lines.push(`Rotation: ${unit.movement.rotation.toFixed(2)}`);
        if (unit.movement.moveTarget) {
            lines.push(`Move Target: (${Math.round(unit.movement.moveTarget.x)}, ${Math.round(unit.movement.moveTarget.y)})`);
        }
        lines.push(`Stuck Timer: ${unit.movement.stuckTimer}`);

        // Combat
        if (unit.combat.targetId) {
            lines.push(`Attack Target: ${unit.combat.targetId}`);
        }

        // Harvester-specific
        if (isHarvester(unit)) {
            lines.push('');
            lines.push(`Cargo: ${unit.harvester.cargo}`);
            if (unit.harvester.resourceTargetId) {
                lines.push(`Resource Target: ${unit.harvester.resourceTargetId}`);
            }
            if (unit.harvester.baseTargetId) {
                lines.push(`Base Target: ${unit.harvester.baseTargetId}`);
            }
        }

        // Group membership
        if (entity.owner !== -1) {
            const aiState = getAIState(entity.owner);
            const groups: string[] = [];

            if (aiState.attackGroup.includes(entityId)) {
                groups.push('attackGroup');
            }
            if (aiState.harassGroup.includes(entityId)) {
                groups.push('harassGroup');
            }
            if (aiState.defenseGroup.includes(entityId)) {
                groups.push('defenseGroup');
            }

            for (const og of aiState.offensiveGroups) {
                if (og.unitIds.includes(entityId)) {
                    groups.push(og.id);
                }
            }

            if (groups.length > 0) {
                lines.push('');
                lines.push(`Groups: ${groups.join(', ')}`);
            }
        }
    }

    return lines.join('\n');
}

// ============================================================================
// Find Formatter
// ============================================================================

/**
 * Parse a query string into filter criteria.
 * Format: "key1=value1,key2=value2"
 */
function parseQuery(query: string): Record<string, string> {
    const filters: Record<string, string> = {};
    const pairs = query.split(',');

    for (const pair of pairs) {
        const [key, value] = pair.split('=');
        if (key && value) {
            filters[key.trim().toLowerCase()] = value.trim();
        }
    }

    return filters;
}

/**
 * Find entities matching a query.
 */
export function formatFind(state: GameState, query: string): string {
    const filters = parseQuery(query);
    const entities = Object.values(state.entities);

    // Filter entities
    const matches = entities.filter(entity => {
        // Skip dead entities
        if (entity.dead) return false;

        // Check type filter
        if (filters.type) {
            const typeFilter = filters.type.toLowerCase();
            if (entity.type.toLowerCase() !== typeFilter) {
                // Also try matching by key (e.g., type=rifle means key=rifle)
                if (entity.key.toLowerCase() !== typeFilter) {
                    return false;
                }
            }
        }

        // Check owner filter
        if (filters.owner) {
            const ownerFilter = parseInt(filters.owner, 10);
            if (entity.owner !== ownerFilter) {
                return false;
            }
        }

        // Check key filter
        if (filters.key) {
            if (entity.key.toLowerCase() !== filters.key.toLowerCase()) {
                return false;
            }
        }

        return true;
    });

    if (matches.length === 0) {
        return 'No entities found matching query';
    }

    const lines: string[] = [];
    lines.push(`Found ${matches.length} entities:`);
    lines.push('');

    // Show first 20 matches
    const displayCount = Math.min(20, matches.length);
    for (let i = 0; i < displayCount; i++) {
        const entity = matches[i];
        const hpPercent = Math.round((entity.hp / entity.maxHp) * 100);
        lines.push(`  ${entity.id}: ${entity.key} (owner=${entity.owner}, ${hpPercent}%, pos=${Math.round(entity.pos.x)},${Math.round(entity.pos.y)})`);
    }

    // Show truncation notice
    if (matches.length > 20) {
        lines.push('');
        lines.push(`  ... and ${matches.length - 20} more`);
    }

    return lines.join('\n');
}

// ============================================================================
// Groups Formatter
// ============================================================================

/**
 * Format group information for a player.
 */
export function formatGroups(playerId: number): string {
    const aiState = getAIState(playerId);
    const lines: string[] = [];

    let hasGroups = false;

    // Attack group
    if (aiState.attackGroup.length > 0) {
        hasGroups = true;
        lines.push(`Attack Group: ${aiState.attackGroup.length} units`);
        const preview = aiState.attackGroup.slice(0, 5).join(', ');
        lines.push(`  Units: ${preview}${aiState.attackGroup.length > 5 ? '...' : ''}`);
        lines.push('');
    }

    // Harass group
    if (aiState.harassGroup.length > 0) {
        hasGroups = true;
        lines.push(`Harass Group: ${aiState.harassGroup.length} units`);
        lines.push('');
    }

    // Defense group
    if (aiState.defenseGroup.length > 0) {
        hasGroups = true;
        lines.push(`Defense Group: ${aiState.defenseGroup.length} units`);
        lines.push('');
    }

    // Offensive groups
    for (const group of aiState.offensiveGroups) {
        hasGroups = true;
        lines.push(`Offensive Group ${group.id}:`);
        lines.push(`  Status: ${group.status}`);
        lines.push(`  Units: ${group.unitIds.length}`);
        if (group.target) {
            lines.push(`  Target: ${group.target}`);
        }
        if (group.rallyPoint) {
            lines.push(`  Rally: (${Math.round(group.rallyPoint.x)}, ${Math.round(group.rallyPoint.y)})`);
        }
        lines.push(`  Health: ${group.avgHealthPercent}%`);
        lines.push('');
    }

    if (!hasGroups) {
        return 'No active groups';
    }

    return lines.join('\n').trimEnd();
}

// ============================================================================
// Event Formatters
// ============================================================================

/**
 * Format a single debug event for display.
 */
export function formatEvent(event: DebugEvent): string {
    const tick = `[${event.tick}]`;
    const entityPart = 'entityId' in event && event.entityId ? ` ${event.entityId}` : '';

    switch (event.type) {
        case 'command': {
            const { command, source, destination, target } = event.data;
            let details = `${command} (${source})`;
            if (destination) {
                details += ` to (${destination.x}, ${destination.y})`;
            }
            if (target) {
                details += ` target=${target}`;
            }
            return `${tick} command${entityPart}: ${details}`;
        }

        case 'decision': {
            const { category, action, reason } = event.data;
            return `${tick} decision: ${category}/${action} - ${reason}`;
        }

        case 'state-change': {
            const { subject, field, from, to } = event.data;
            return `${tick} state-change${entityPart}: ${subject}.${field}: ${JSON.stringify(from)} -> ${JSON.stringify(to)}`;
        }

        case 'group': {
            const { groupId, action, status } = event.data;
            let details = `${groupId} ${action}`;
            if (status) {
                details += ` (${status})`;
            }
            return `${tick} group: ${details}`;
        }

        case 'economy': {
            const { credits, delta, source } = event.data;
            const sign = delta >= 0 ? '+' : '';
            return `${tick} economy: ${credits} (${sign}${delta}) via ${source}`;
        }

        case 'production': {
            const { action, category, key } = event.data;
            return `${tick} production: ${action} ${category}/${key}`;
        }

        case 'threat': {
            const { threatLevel, economyScore, desperation, isDoomed } = event.data;
            return `${tick} threat: level=${threatLevel}, economy=${economyScore}, desperation=${desperation}, doomed=${isDoomed}`;
        }

        default:
            return `${tick} unknown event type`;
    }
}

/**
 * Format the last N events.
 */
export function formatEvents(events: DebugEvent[], count: number = 20): string {
    if (events.length === 0) {
        return '';
    }

    // Take the last N events
    const lastEvents = events.slice(-count);

    return lastEvents.map(formatEvent).join('\n');
}
