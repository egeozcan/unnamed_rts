## 3. Stealth Mechanics

**Idea**: Units that remain hidden unless moving, firing, or detected by specific counter-measures.

**Implementation Direction**:
- **Stealth States**: (1) Hidden, (2) Partial Detection (blip on minimap/shimmer effect), (3) Fully Revealed.
- **Logic**: `StealthComponent` with `isStealthed` and `stealthCooldown`. Stealth activates after N ticks of holding fire/remaining stationary.
- **Detection**: 
    - Units only visible within a very short "detection range" or when adjacent.
    - **Detectors**: Radar vehicles or "Sonar Pulse" abilities to reveal areas.
- **Visuals**: Semi-transparent for owner, invisible (or subtle predator-style shimmer when moving) for enemies.

**Hardness**: 5/10 | **Complexity**: 4/10
