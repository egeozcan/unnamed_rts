## 2. Fog of War & Advanced Vision

**Idea**: Implement a fog of war system with explored and visible states, affecting both players and AI.

**Implementation Direction**:
- **State**: Add a `visibility: Uint8Array` grid per player/team. Use bitmasks: `0=Shroud` (unexplored), `1=Fog` (explored but not visible), `2=Visible` (currently seen).
- **Update Logic**: Recalculate visibility each tick based on `vision` range of owned entities. Use "Dirty Rectangles" to optimize updates.
- **Renderer**: Show "ghost" sprites or only terrain in Fog areas; completely black in Shroud.
- **Advanced Features**:
    - **Shared Vision**: Implement team-based vision from the start.
    - **Scan Ability**: Comm Center "Radar Sweep" ability to momentarily reveal an area.
    - **Reveal-on-Death**: Briefly reveal a unit's last position to allies upon death.
- **AI**: Add an "Honest AI" option that filters known entities by visibility.

**Hardness**: 6/10 | **Complexity**: 7/10
