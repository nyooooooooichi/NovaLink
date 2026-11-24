# NOVALINK LIFE — Game Design Document

## Product direction
A large, expandable, turn-based life board game played inside a NovaLink meeting room. The initial release targets 2–10 players. Players share one board, take turns in a fixed order, roll a die, move their own pawn, and resolve the space they land on. The design must support content updates without rewriting the turn engine.

## Confirmed decisions
- Board presentation: large life-game-style board.
- Turn model: one player acts at a time.
- Expansion model: ongoing content additions.
- Session: tied to the active NovaLink meeting room.
- Target capacity: up to 10 participants.

## Core game loop
1. Host opens the Games panel and creates a NOVALINK LIFE session.
2. Meeting participants join the game lobby; the host starts when ready.
3. Server freezes the player order and initializes each player.
4. Active player rolls a server-generated die.
5. Server calculates the destination and broadcasts the move.
6. The landing tile creates a deterministic event or choice.
7. The active player chooses an option when required; server validates and applies it.
8. Turn advances to the next eligible player.
9. The game ends when the configured final condition is met; server calculates standings.

## Initial rules proposal
- 2–10 players.
- One shared board with a clear start, themed regions, branching routes, and a finish.
- Each player starts with a configurable amount of cash and baseline stats.
- A standard six-sided die is rolled by the server.
- Movement, money, inventory, status effects, event resolution, and turn order are server-authoritative.
- Players who disconnect remain in the session for a grace period; the host may resume or remove an abandoned player.
- A reconnecting player receives the current complete game snapshot.
- Host can pause/resume; host cannot alter dice outcomes or player balances.
- Initial game length target: 30–90 minutes, adjustable by board length and event frequency.

## Board structure
The board is data-driven rather than hard-coded into the UI:
- Tile fields: stable ID, region ID, display name, tile type, visual theme, event pool ID, and optional branching destinations.
- Tile types: start, salary, career, education, purchase, investment, life event, chance, choice, travel, tax/fee, and finish.
- Regions are released in stages. New regions and tile pools can be added through versioned content data.
- The client renders the same board data for every participant and animates pawns between tile coordinates.

## Player model (initial)
- Identity: meeting socket ID plus display name and optional account profile.
- Position and turn state.
- Cash, income, recurring expenses, assets, debt.
- Career, education, skills, relationships, and status effects.
- Inventory and achievement flags.
All values that affect outcomes are owned and validated by the server.

## Event and choice system
- Events are selected from versioned pools with explicit eligibility conditions.
- Choices have stable IDs and server-defined effects.
- Random outcomes use server-side randomness; clients never submit a result.
- Event text and effects are separate so content can be expanded and localized.
- Every resolved event is added to a session history for replay/debugging.

## Multiplayer authority and synchronization
Use the existing Socket.IO server and the current meeting room ID.
Suggested event namespace:
- `life:create` — host creates a session.
- `life:join` — participant joins the session.
- `life:ready` — participant toggles ready state.
- `life:start` — host starts the game.
- `life:roll` — active player requests a roll.
- `life:choose` — active player submits a choice ID.
- `life:state` — server broadcasts the authoritative snapshot.
- `life:event` — server broadcasts a resolved event.
- `life:pause` / `life:resume` — host controls session pause.
- `life:rejoin` — client requests the current snapshot.
Every mutating action must validate room membership, game phase, active player, and action rate. Clients must not be trusted to submit positions, dice values, balances, or effects.

## UI direction
- Meeting controls gain a Games entry point.
- Game opens as a large in-call overlay/panel without leaving the video call.
- Main area: zoomable/pannable board with pawn markers and animated movement.
- Side panel: active player, turn order, player status, cash/assets, and event log.
- Action area: roll button, event card, and choice buttons.
- Mobile layout: board first, collapsible player/event panels, large touch targets.
- Reduced-motion mode and keyboard-accessible controls.

## Persistence and reliability
The current NovaLink room and chat state is in server memory and is lost on server restart. The first playable prototype may follow that model, but persistent saved games require durable storage. Before adding persistence, choose a database schema and ownership model. A later release should support session snapshots, event history, and safe resume after server restart.

## Release plan
### Phase 0 — Design and data contracts
Confirm rules, board regions, tile schema, player schema, and disconnect behavior.

### Phase 1 — Playable foundation
Add in-call Games entry point, game lobby, ready state, fixed turn order, server dice roll, pawn movement, a small starter board, and a handful of event tiles.

### Phase 2 — Life systems
Add career, salary, expenses, education, purchases, assets, debt, and end-of-game ranking.

### Phase 3 — Content expansion
Add more regions, branching routes, larger event pools, collectibles, achievements, and balancing tools.

### Phase 4 — Persistence and social systems
Add saved sessions, reconnect/resume across server restarts, optional account-linked records, and expanded player-to-player interactions.

## Non-goals for the first playable release
- Real-money purchases, gambling, or cash-out.
- Unmoderated user-authored event effects.
- Client-authoritative game state.
- Full 3D open world; the chosen format is a large board game.

## Acceptance criteria for the first playable release
- 2–10 participants can join one game from the same meeting.
- Only the active player can roll or choose an event option.
- All participants see the same roll, movement, event, and updated state.
- A reconnecting participant receives the current state.
- A player cannot forge dice values, movement, money, or another player's turn.
- The game can be expanded by adding board/event data without changing the turn engine.
