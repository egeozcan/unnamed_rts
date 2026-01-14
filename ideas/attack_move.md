## 15. Attack-Move Command

**Idea**: Units move to a destination but stop to engage any enemies encountered along the path.

**Implementation Direction**:
- **State**: `attackMoveTarget` field.
- **Logic**: Periodic scans for enemies within weapon range while moving. Resume move once target is clear or out of range.
- **Hotkey**: A-click or Ctrl+Right-click.

**Hardness**: 3/10 | **Complexity**: 4/10
