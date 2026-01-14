## 4. Heavy Weapons Differentiation: Artillery vs. MLRS

**Idea**: Create a meaningful distinction between siege artillery and area-denial rocket systems.

**Implementation Direction**:
- **Artillery (Siege)**: High damage, single target, long reload, very long range (outranges towers). Bonus vs. buildings. Slow projectile with visible arc.
- **MLRS (Anti-Blob)**: Fires a salvo of 4-6 rockets in a spread pattern. Faster reload, shorter range. Effective against groups of infantry/light vehicles.
- **Component**: `SalvoComponent` for MLRS to track remaining rockets in a burst.

**Hardness**: 3/10 | **Complexity**: 4/10
