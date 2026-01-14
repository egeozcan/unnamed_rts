## 1. APC Infantry Transport & Tactical Ejection

**Idea**: APCs should be able to transport infantry, providing mobility and protection. This logic can be extended to defensive structures like Bunkers.

**Implementation Direction**:
- **Core**: Add a `TransportComponent` with `capacity`, `passengers: EntityId[]`, and `loadCooldown`.
- **Actions**: `LOAD_UNIT` (infantry enters), `UNLOAD_UNIT` (infantry exits), `UNLOAD_ALL`.
- **Interaction**: Infantry near an APC can be ordered inside via right-click. Passengers are either removed from `state.entities` or marked with `transported: true`.
- **Death Handling**: If the transport is destroyed, passengers take 50% damage and are ejected. If damage is fatal, play a "crushed" animation.
- **Extensions**: 
    - **Bunkers**: Reuse transport logic for stationary defensive structures with higher HP.
    - **Airlift**: Use for air units like an "Orca Transport" to paradrop infantry.
    - **Amphibious**: Use for hovercraft/landing craft if water terrain is added.
- **UI**: Show passenger count on the selection panel.

**Hardness**: 4/10 | **Complexity**: 5/10
