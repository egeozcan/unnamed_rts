## 5. Flame Weaponry & Persistent Hazards

**Idea**: Flame units that spray fire, effective against infantry and capable of creating area-of-effect hazards.

**Implementation Direction**:
- **Flame Zone**: Attack creates a temporary "flame zone" (area entity or spatial grid mark) that persists for N ticks.
- **Damage**: Damages all units inside (friend or foe). High vs. infantry, low vs. heavy armor.
- **Panic Mechanic**: Infantry hit by fire may "panic" (loss of control, move randomly) for 2s.
- **Terrain Scarring**: Leave persistent fire entities that don't block movement but deal damage.

**Hardness**: 5/10 | **Complexity**: 6/10
