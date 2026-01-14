## 12. Dynamic Soundtrack & Audio System

**Idea**: Music and audio cues that evolve based on game intensity.

**Implementation Direction**:
- **States**: Peace, Tension, Combat. Switch based on a "Threat Meter" (sum of enemy cost in vision).
- **Audio Feedback**:
    - **Unit Acknowledgment**: "Yes sir", "Acknowledged" on orders.
    - **Event Cues**: "Unit lost", "Building complete", "Low power" alerts.
    - **Announcer**: Tactical voice feedback for major events.

**Hardness**: 4/10 | **Complexity**: 4/10
