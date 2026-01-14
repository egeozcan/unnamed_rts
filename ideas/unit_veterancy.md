## 9. Unit Veterancy (Elite Status)

**Idea**: Units gain experience from kills, unlocking stat boosts and special abilities.

**Implementation Direction**:
- **XP System**: Award XP to the damaging unit upon `destroyEntity`.
- **Ranks**:
    - **Veteran (Rank 1)**: +10% Damage, +10% Speed.
    - **Elite (Rank 3)**: +20% HP, Self-healing, unique weapon visuals (e.g., blue lasers).
- **UI**: Star icon or chevron above unit health bar.

**Hardness**: 4/10 | **Complexity**: 5/10
