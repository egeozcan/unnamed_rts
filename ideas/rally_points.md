## 16. Rally Points for Production

**Idea**: Automatically issue move orders to newly produced units.

**Implementation Direction**:
- **Logic**: Building-specific `rallyPoint`. On unit completion, issue a move action to the point.
- **Extensions**: Rallying to a unit makes the new unit follow/guard it (e.g., Harvesters to Refinery).
- **UI**: Visual line/flag when the production building is selected.

**Hardness**: 2/10 | **Complexity**: 3/10
