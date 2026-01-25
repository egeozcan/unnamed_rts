import { EntityId, Vector } from '../../types.js';

// Harvester roles determine risk tolerance
export type HarvesterRole = 'safe' | 'standard' | 'risk-taker' | 'opportunist';

// Danger zone tracking
export interface DangerZone {
    key: string;              // "zoneX,zoneY" format
    dangerScore: number;      // 0-100
    enemyCount: number;       // Current enemies in zone
    recentAttacks: number;    // Attack events in last 300 ticks
    harvesterDeaths: number;  // Deaths in last 1800 ticks
    lastUpdate: number;       // Tick of last update
}

// Harvester death record for memory
export interface HarvesterDeathRecord {
    position: Vector;
    tick: number;
    zoneKey: string;
}

// Stuck escalation levels
export type StuckLevel = 1 | 2 | 3 | 4 | 5;

// Per-harvester stuck state
// Note: Blacklisting is done globally in HarvesterAIState.blacklistedOre,
// not per-harvester, since ore that causes problems for one harvester
// is likely problematic for all.
export interface HarvesterStuckState {
    stuckTicks: number;
    currentLevel: StuckLevel;
    lastActionTick: number;
}

// Main harvester AI state (per player)
export interface HarvesterAIState {
    // Danger map: zoneKey -> DangerZone
    dangerMap: Map<string, DangerZone>;
    dangerMapLastUpdate: number;

    // Desperation
    desperationScore: number;  // 0-100

    // Coordinator
    harvesterRoles: Map<EntityId, HarvesterRole>;
    oreFieldClaims: Map<EntityId, EntityId[]>;  // ore -> harvesters
    refineryQueue: Map<EntityId, EntityId[]>;   // refinery -> incoming harvesters

    // Escort
    escortAssignments: Map<EntityId, EntityId>; // combat unit -> ore field

    // Stuck resolution
    blacklistedOre: Map<EntityId, number>;      // ore -> expiry tick
    stuckStates: Map<EntityId, HarvesterStuckState>;

    // Death memory
    harvesterDeaths: HarvesterDeathRecord[];
}

// Constants for the harvester AI system
export const HARVESTER_AI_CONSTANTS = {
    // Zone configuration
    ZONE_SIZE: 200,                    // pixels per zone
    DANGER_MAP_UPDATE_INTERVAL: 30,    // ticks

    // Danger score weights
    ENEMY_PRESENCE_WEIGHT: 10,
    RECENT_ATTACK_WEIGHT: 15,
    DEATH_MEMORY_WEIGHT: 25,

    // Decay windows
    ATTACK_MEMORY_WINDOW: 300,         // 5 seconds
    DEATH_MEMORY_WINDOW: 1800,         // 30 seconds

    // Desperation thresholds
    DESPERATION_UPDATE_INTERVAL: 60,
    CREDITS_DESPERATE_THRESHOLD: 5000,
    HARVESTER_RATIO_DESPERATE: 1.5,
    EARLY_GAME_TICKS: 10800,           // 3 minutes

    // Coordinator
    COORDINATOR_UPDATE_INTERVAL: 60,
    MAX_HARVESTERS_PER_ORE: 3,
    MAX_HARVESTERS_PER_REFINERY: 2,

    // Escort
    ESCORT_UPDATE_INTERVAL: 90,
    ESCORT_PATROL_RADIUS: 150,
    ESCORT_RELEASE_DANGER: 30,
    ESCORT_ASSIGN_DANGER: 40,
    ESCORT_PRIORITY_DANGER: 70,

    // Stuck resolution
    STUCK_LEVEL_1_TICKS: 5,
    STUCK_LEVEL_2_TICKS: 15,
    STUCK_LEVEL_3_TICKS: 30,
    STUCK_LEVEL_4_TICKS: 45,
    STUCK_LEVEL_5_TICKS: 60,
    STUCK_COOLDOWN_1: 30,
    STUCK_COOLDOWN_2: 60,
    STUCK_COOLDOWN_3: 120,
    STUCK_COOLDOWN_4: 180,
    STUCK_COOLDOWN_5: 300,
    BLACKLIST_DURATION: 180,
    DETOUR_SEARCH_RADIUS: 300,
} as const;

// Initial state factory
export function createInitialHarvesterAIState(): HarvesterAIState {
    return {
        dangerMap: new Map(),
        dangerMapLastUpdate: 0,
        desperationScore: 30,
        harvesterRoles: new Map(),
        oreFieldClaims: new Map(),
        refineryQueue: new Map(),
        escortAssignments: new Map(),
        blacklistedOre: new Map(),
        stuckStates: new Map(),
        harvesterDeaths: []
    };
}
