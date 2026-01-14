## 19. Spectator & Replay System

**Idea**: Record and playback matches for analysis or spectating.

**Implementation Direction**:
- **Replay**: Store initial state + action sequence. Re-simulate deterministically.
- **Spectator**: WebSocket stream of actions to clients with a configurable delay.

**Hardness**: 5/10 | **Complexity**: 6/10
