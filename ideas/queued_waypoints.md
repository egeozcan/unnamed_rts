## 13. Queued Waypoints & Patrol Routes

**Idea**: Allow complex movement orders through shift-clicking and looping routes.

**Implementation Direction**:
- **Waypoints**: Maintain a queue of positions; pop and move to the next upon arrival.
- **Patrol**: Loop the queue once exhausted.
- **UI**: Visual lines connecting waypoints when the unit is selected.

**Hardness**: 3/10 | **Complexity**: 4/10
