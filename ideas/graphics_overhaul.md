## 8. Visual & Graphics Overhaul

**Idea**: Incremental improvements to the game's aesthetic and feedback.

**Implementation Direction**:
- **Shadows**: Simple oval shadows under units.
- **Animations**: Infantry ragdolls, vehicle wrecks that linger, scaffolding for buildings under construction.
- **Particles**: Muzzle flashes, dust clouds, smoke from damaged units, missile trails.
- **Optimization**: Use instanced mesh drawing or batched canvas calls to handle many particles.
- **Lighting**: Vignette overlays and color grading (sepia/blue tints) for cheap mood setting.

**Hardness**: 3-7/10 | **Complexity**: 6/10
