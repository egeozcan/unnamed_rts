import { DEFAULT_AI_IMPLEMENTATION_ID } from '../engine/ai/index.js';
import { PlayerType } from '../engine/types.js';

type MapSize = 'small' | 'medium' | 'large' | 'huge';
type Density = 'low' | 'medium' | 'high';

export interface PersistedSkirmishPlayerSlot {
    type: PlayerType;
    aiImplementationId: string;
}

export interface PersistedSkirmishSettings {
    version: 1;
    players: PersistedSkirmishPlayerSlot[];
    mapSize: MapSize;
    resourceDensity: Density;
    rockDensity: Density;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const PLAYER_TYPES: readonly PlayerType[] = ['human', 'dummy', 'easy', 'medium', 'hard', 'none'];
const MAP_SIZES: readonly MapSize[] = ['small', 'medium', 'large', 'huge'];
const DENSITY_OPTIONS: readonly Density[] = ['low', 'medium', 'high'];

export const SKIRMISH_SETTINGS_STORAGE_KEY = 'unnamed_rts.skirmish_settings.v1';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function asPlayerType(value: unknown): PlayerType | null {
    if (typeof value !== 'string') return null;
    return PLAYER_TYPES.includes(value as PlayerType) ? (value as PlayerType) : null;
}

function asMapSize(value: unknown): MapSize | null {
    if (typeof value !== 'string') return null;
    return MAP_SIZES.includes(value as MapSize) ? (value as MapSize) : null;
}

function asDensity(value: unknown): Density | null {
    if (typeof value !== 'string') return null;
    return DENSITY_OPTIONS.includes(value as Density) ? (value as Density) : null;
}

function defaultPlayerTypeForSlot(index: number): PlayerType {
    if (index === 0) return 'human';
    if (index === 1) return 'medium';
    return 'none';
}

function hasOption(select: HTMLSelectElement, value: string): boolean {
    return Array.from(select.options).some(option => option.value === value);
}

export function collectSkirmishSettingsFromUI(root: ParentNode = document): PersistedSkirmishSettings {
    const playerSlots = Array.from(root.querySelectorAll('.player-slot'));

    const players: PersistedSkirmishPlayerSlot[] = playerSlots.map((slot, index) => {
        const typeSelect = slot.querySelector('.player-type') as HTMLSelectElement | null;
        const aiSelect = slot.querySelector('.ai-implementation') as HTMLSelectElement | null;

        const type = asPlayerType(typeSelect?.value) ?? defaultPlayerTypeForSlot(index);
        const aiImplementationId = (aiSelect?.value || '').trim() || DEFAULT_AI_IMPLEMENTATION_ID;
        return { type, aiImplementationId };
    });

    const mapSizeSelect = root.querySelector('#map-size') as HTMLSelectElement | null;
    const resourceDensitySelect = root.querySelector('#resource-density') as HTMLSelectElement | null;
    const rockDensitySelect = root.querySelector('#rock-density') as HTMLSelectElement | null;

    return {
        version: 1,
        players,
        mapSize: asMapSize(mapSizeSelect?.value) ?? 'medium',
        resourceDensity: asDensity(resourceDensitySelect?.value) ?? 'medium',
        rockDensity: asDensity(rockDensitySelect?.value) ?? 'medium'
    };
}

export function normalizePersistedSkirmishSettings(
    value: unknown,
    slotCount: number
): PersistedSkirmishSettings | null {
    if (!isRecord(value)) return null;

    const hasRelevantField = 'players' in value || 'mapSize' in value || 'resourceDensity' in value || 'rockDensity' in value;
    if (!hasRelevantField) return null;

    const rawPlayers = Array.isArray(value.players) ? value.players : [];

    const players: PersistedSkirmishPlayerSlot[] = Array.from({ length: slotCount }, (_, index) => {
        const rawSlot = rawPlayers[index];
        const defaultType = defaultPlayerTypeForSlot(index);

        if (!isRecord(rawSlot)) {
            return {
                type: defaultType,
                aiImplementationId: DEFAULT_AI_IMPLEMENTATION_ID
            };
        }

        return {
            type: asPlayerType(rawSlot.type) ?? defaultType,
            aiImplementationId: typeof rawSlot.aiImplementationId === 'string' && rawSlot.aiImplementationId.trim().length > 0
                ? rawSlot.aiImplementationId
                : DEFAULT_AI_IMPLEMENTATION_ID
        };
    });

    return {
        version: 1,
        players,
        mapSize: asMapSize(value.mapSize) ?? 'medium',
        resourceDensity: asDensity(value.resourceDensity) ?? 'medium',
        rockDensity: asDensity(value.rockDensity) ?? 'medium'
    };
}

export function applySkirmishSettingsToUI(
    settings: PersistedSkirmishSettings,
    root: ParentNode = document
): void {
    const slots = Array.from(root.querySelectorAll('.player-slot'));

    slots.forEach((slot, index) => {
        const typeSelect = slot.querySelector('.player-type') as HTMLSelectElement | null;
        const aiSelect = slot.querySelector('.ai-implementation') as HTMLSelectElement | null;
        const slotSettings = settings.players[index];

        if (!slotSettings) return;

        if (typeSelect && hasOption(typeSelect, slotSettings.type)) {
            typeSelect.value = slotSettings.type;
        }

        if (aiSelect) {
            const aiValue = hasOption(aiSelect, slotSettings.aiImplementationId)
                ? slotSettings.aiImplementationId
                : DEFAULT_AI_IMPLEMENTATION_ID;
            if (hasOption(aiSelect, aiValue)) {
                aiSelect.value = aiValue;
            }
        }
    });

    const mapSizeSelect = root.querySelector('#map-size') as HTMLSelectElement | null;
    if (mapSizeSelect && hasOption(mapSizeSelect, settings.mapSize)) {
        mapSizeSelect.value = settings.mapSize;
    }

    const resourceDensitySelect = root.querySelector('#resource-density') as HTMLSelectElement | null;
    if (resourceDensitySelect && hasOption(resourceDensitySelect, settings.resourceDensity)) {
        resourceDensitySelect.value = settings.resourceDensity;
    }

    const rockDensitySelect = root.querySelector('#rock-density') as HTMLSelectElement | null;
    if (rockDensitySelect && hasOption(rockDensitySelect, settings.rockDensity)) {
        rockDensitySelect.value = settings.rockDensity;
    }
}

export function loadSkirmishSettingsFromStorage(
    storage: StorageLike,
    slotCount: number
): PersistedSkirmishSettings | null {
    try {
        const raw = storage.getItem(SKIRMISH_SETTINGS_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as unknown;
        return normalizePersistedSkirmishSettings(parsed, slotCount);
    } catch {
        return null;
    }
}

export function saveSkirmishSettingsToStorage(
    storage: StorageLike,
    settings: PersistedSkirmishSettings
): void {
    try {
        storage.setItem(SKIRMISH_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
        // Best-effort persistence; ignore quota/security failures.
    }
}
