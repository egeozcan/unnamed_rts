/**
 * Skirmish setup screen polish: accessible names for the per-slot selects, tooltips, and a
 * one-line description of the focused slot's difficulty and AI personality.
 */
import type { AIImplementationOption } from '../engine/ai/contracts.js';

export const DIFFICULTY_DESCRIPTIONS: Record<string, string> = {
    human: 'You command this army.',
    dummy: 'Dummy AI: builds a base but never attacks - for practice.',
    easy: 'Easy AI: slower build-up and smaller attacks.',
    medium: 'Medium AI: a balanced opponent.',
    hard: 'Hard AI: fastest economy, attacks early and often.',
    none: 'Closed: nobody plays in this slot.'
};

/** One line describing a slot: "Medium AI: a balanced opponent. Classic: Current built-in RTS AI behavior." */
export function describeSlot(type: string, implementation: AIImplementationOption | undefined): string {
    const base = DIFFICULTY_DESCRIPTIONS[type] ?? '';
    const isAi = type !== 'human' && type !== 'none';
    if (!isAi || !implementation) return base;
    const personality = implementation.description
        ? `${implementation.name}: ${implementation.description}`
        : implementation.name;
    return `${base} ${personality}`;
}

/** Label the slot selects and keep the description line in sync with the slot being edited. */
export function enhanceSkirmishSetup(aiOptions: readonly AIImplementationOption[]): void {
    const optionById = new Map(aiOptions.map(o => [o.id, o]));
    const description = document.getElementById('setup-description');

    // Personality options get their description as a tooltip
    document.querySelectorAll<HTMLSelectElement>('.ai-implementation').forEach(select => {
        for (const option of Array.from(select.options)) {
            const desc = optionById.get(option.value)?.description;
            if (desc) option.title = desc;
        }
    });

    document.querySelectorAll<HTMLElement>('.player-slot').forEach((slot, index) => {
        const n = index + 1;
        const team = slot.querySelector<HTMLSelectElement>('.player-team');
        const type = slot.querySelector<HTMLSelectElement>('.player-type');
        const ai = slot.querySelector<HTMLSelectElement>('.ai-implementation');

        if (team) {
            team.setAttribute('aria-label', `Player ${n} team`);
            team.title = 'Team: players on the same team are allies. FFA = free-for-all';
        }
        if (type) type.setAttribute('aria-label', `Player ${n}: human, AI difficulty or closed`);
        if (ai) ai.setAttribute('aria-label', `Player ${n} AI personality`);

        const refresh = () => {
            const typeValue = type?.value ?? 'none';
            const impl = ai ? optionById.get(ai.value) : undefined;
            const text = describeSlot(typeValue, impl);
            if (type) type.title = DIFFICULTY_DESCRIPTIONS[typeValue] ?? '';
            if (ai) ai.title = impl ? (impl.description ? `${impl.name}: ${impl.description}` : impl.name) : '';
            return `Player ${n} - ${text}`;
        };
        const show = () => {
            if (description) description.textContent = refresh();
        };

        refresh();
        for (const el of [team, type, ai]) {
            el?.addEventListener('focus', show);
            el?.addEventListener('change', show);
        }
        slot.addEventListener('mouseenter', show);
    });
}
