/**
 * Debug event collector with filtering capabilities.
 *
 * Collects debug events during gameplay and exports them to JSONL format
 * for later analysis. Supports filtering by:
 * - Event categories (command, decision, state-change, etc.)
 * - Specific entities (unit IDs)
 * - Specific players
 * - Change-only mode (skip if value unchanged)
 * - Thresholds (minimum delta, threat level, etc.)
 */

import type { DebugEvent, MetaLine } from '../../engine/debug/schemas.js';

// ============================================================================
// Filter Configuration
// ============================================================================

export interface FilterConfig {
    categories: {
        command: boolean;
        decision: boolean;
        'state-change': boolean;
        group: boolean;
        economy: boolean;
        production: boolean;
        threat: boolean;
    };
    trackedEntities: Set<string>;  // empty = track all
    trackedPlayers: Set<number>;   // empty = track all
    changeOnly: {
        economy: boolean;   // skip if credits unchanged
        threat: boolean;    // skip if threatLevel unchanged
        strategy: boolean;  // skip if strategy unchanged
    };
    thresholds: {
        hpBelow?: number;        // % threshold
        creditsBelow?: number;
        threatAbove?: number;
        economyDelta?: number;   // min |delta| to log
    };
    snapshotInterval: number;  // ticks between snapshots, 0 = disabled
}

/**
 * Creates a default filter configuration with all categories enabled,
 * empty whitelists, and reasonable defaults for change-only filtering.
 */
export function createDefaultFilterConfig(): FilterConfig {
    return {
        categories: {
            command: true,
            decision: true,
            'state-change': true,
            group: true,
            economy: true,
            production: true,
            threat: true
        },
        trackedEntities: new Set(),
        trackedPlayers: new Set(),
        changeOnly: {
            economy: true,
            threat: true,
            strategy: false
        },
        thresholds: {},
        snapshotInterval: 100
    };
}

// ============================================================================
// Debug Collector
// ============================================================================

/**
 * Collects and filters debug events, with JSONL export capability.
 */
export class DebugCollector {
    private events: DebugEvent[] = [];
    private config: FilterConfig = createDefaultFilterConfig();
    private lastValues: Map<string, unknown> = new Map();

    /**
     * Update the filter configuration.
     */
    setConfig(config: FilterConfig): void {
        this.config = config;
    }

    /**
     * Get the current filter configuration.
     */
    getConfig(): FilterConfig {
        return this.config;
    }

    /**
     * Collect an event if it passes all configured filters.
     */
    collect(event: DebugEvent): void {
        if (!this.passesFilters(event)) {
            return;
        }
        this.events.push(event);
    }

    /**
     * Get all collected events (returns a copy).
     */
    getEvents(): DebugEvent[] {
        return [...this.events];
    }

    /**
     * Clear all collected events and reset change tracking.
     */
    clear(): void {
        this.events = [];
        this.lastValues.clear();
    }

    /**
     * Export events within the specified tick range to JSONL format.
     *
     * @param startTick - Include events from this tick (inclusive)
     * @param endTick - Include events up to this tick (inclusive)
     * @returns JSONL string with meta line first, then event lines
     */
    exportToJsonl(startTick: number, endTick: number): string {
        const filteredEvents = this.events.filter(
            e => e.tick >= startTick && e.tick <= endTick
        );

        const meta: MetaLine = {
            _meta: true,
            version: '1.0.0',
            startTick,
            endTick,
            filters: {
                categories: this.getEnabledCategories(),
                trackedEntities: Array.from(this.config.trackedEntities),
                trackedPlayers: Array.from(this.config.trackedPlayers),
                thresholds: this.getActiveThresholds()
            },
            recordedAt: new Date().toISOString()
        };

        const lines: string[] = [JSON.stringify(meta)];
        for (const event of filteredEvents) {
            lines.push(JSON.stringify(event));
        }

        return lines.join('\n') + '\n';
    }

    // ========================================================================
    // Private Methods
    // ========================================================================

    /**
     * Check if an event passes all configured filters.
     */
    private passesFilters(event: DebugEvent): boolean {
        // Category filter
        if (!this.passesCategoryFilter(event)) {
            return false;
        }

        // Entity whitelist filter
        if (!this.passesEntityFilter(event)) {
            return false;
        }

        // Player whitelist filter
        if (!this.passesPlayerFilter(event)) {
            return false;
        }

        // Change-only filters
        if (!this.passesChangeOnlyFilter(event)) {
            return false;
        }

        // Threshold filters
        if (!this.passesThresholdFilter(event)) {
            return false;
        }

        return true;
    }

    /**
     * Check if event type is enabled in categories config.
     */
    private passesCategoryFilter(event: DebugEvent): boolean {
        const category = event.type as keyof FilterConfig['categories'];
        return this.config.categories[category] === true;
    }

    /**
     * Check if event's entity is in the tracked entities whitelist.
     * Empty whitelist = all entities pass.
     */
    private passesEntityFilter(event: DebugEvent): boolean {
        if (this.config.trackedEntities.size === 0) {
            return true;
        }

        // Events without entityId pass through when whitelist is active
        const entityId = (event as { entityId?: string }).entityId;
        if (entityId === undefined) {
            return true;
        }

        return this.config.trackedEntities.has(entityId);
    }

    /**
     * Check if event's player is in the tracked players whitelist.
     * Empty whitelist = all players pass.
     */
    private passesPlayerFilter(event: DebugEvent): boolean {
        if (this.config.trackedPlayers.size === 0) {
            return true;
        }

        const playerId = (event as { playerId?: number }).playerId;
        if (playerId === undefined) {
            return false;
        }

        return this.config.trackedPlayers.has(playerId);
    }

    /**
     * Check change-only filters for economy and threat events.
     */
    private passesChangeOnlyFilter(event: DebugEvent): boolean {
        if (event.type === 'economy' && this.config.changeOnly.economy) {
            return this.passesEconomyChangeFilter(event);
        }

        if (event.type === 'threat' && this.config.changeOnly.threat) {
            return this.passesThreatChangeFilter(event);
        }

        return true;
    }

    /**
     * Check if economy event has changed credits from last seen value.
     */
    private passesEconomyChangeFilter(event: DebugEvent): boolean {
        const playerId = (event as { playerId?: number }).playerId;
        const data = event.data as { credits: number };
        const key = `economy:${playerId}:credits`;

        const lastCredits = this.lastValues.get(key);
        this.lastValues.set(key, data.credits);

        if (lastCredits === undefined) {
            return true;
        }

        return data.credits !== lastCredits;
    }

    /**
     * Check if threat event has changed threatLevel from last seen value.
     */
    private passesThreatChangeFilter(event: DebugEvent): boolean {
        const playerId = (event as { playerId?: number }).playerId;
        const data = event.data as { threatLevel: number };
        const key = `threat:${playerId}:threatLevel`;

        const lastThreatLevel = this.lastValues.get(key);
        this.lastValues.set(key, data.threatLevel);

        if (lastThreatLevel === undefined) {
            return true;
        }

        return data.threatLevel !== lastThreatLevel;
    }

    /**
     * Check threshold-based filters.
     */
    private passesThresholdFilter(event: DebugEvent): boolean {
        if (event.type === 'economy' && this.config.thresholds.economyDelta !== undefined) {
            const data = event.data as { delta: number };
            if (Math.abs(data.delta) < this.config.thresholds.economyDelta) {
                return false;
            }
        }

        if (event.type === 'threat' && this.config.thresholds.threatAbove !== undefined) {
            const data = event.data as { threatLevel: number };
            if (data.threatLevel <= this.config.thresholds.threatAbove) {
                return false;
            }
        }

        return true;
    }

    /**
     * Get list of enabled category names.
     */
    private getEnabledCategories(): string[] {
        const categories: string[] = [];
        for (const [key, enabled] of Object.entries(this.config.categories)) {
            if (enabled) {
                categories.push(key);
            }
        }
        return categories;
    }

    /**
     * Get active thresholds as a record.
     */
    private getActiveThresholds(): Record<string, number> {
        const thresholds: Record<string, number> = {};
        for (const [key, value] of Object.entries(this.config.thresholds)) {
            if (value !== undefined) {
                thresholds[key] = value;
            }
        }
        return thresholds;
    }
}
