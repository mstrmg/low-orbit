# Low Orbit: Project Brief

Context for anyone (human or AI) working on this project. **Read this first.** It is the source of truth for what the game is, how it works and how it's built. When a decision here changes, update this file.

## 1. What the game is

Low Orbit is a 3D space-station management game that runs in the browser. The player builds and runs a station circling a planet. Each system (power, heat, altitude, docking, crew) is simple on its own; the challenge is that they all affect each other.

**One-line pitch:** "Every decision is really about getting through the next eclipse."

- **Genre:** systems/management sim, real-time with pause.
- **Platform:** desktop browser first (mouse + keyboard). Mobile is not a goal.
- **Tone:** calm, clean, slightly technical. Think "mission control", not "space opera". No combat.

## 2. Design pillars

Use these to decide anything this brief doesn't cover.

1. **The orbit is the clock.** The day/night cycle drives everything. Every system should respond to sunlight vs. shadow.
2. **Systems interact.** A new feature earns its place only if it creates trade-offs with at least two existing systems.
3. **You can read what's coming.** Eclipses, ship arrivals and events show on the timeline ahead of time. Failures come from the player's choices, not hidden randomness.
4. **Small numbers, clear causes.** The player should always be able to tell why something went wrong (for example "Lab B overheated because radiator 2 was facing the sun").
5. **It looks like real orbital physics.** It doesn't have to be accurate, but it should feel right: real lighting, real shadows, a believable planet.

## 3. The orbit cycle (core loop)

| Value | Default | Notes |
| --- | --- | --- |
| Orbit period | 90 s game time | One full lap around the planet |
| Sunlit portion | 55 s | Solar power on, heat rises |
| Eclipse portion | 35 s | No solar power, batteries drain, heat drops |
| Time controls | Pause, 1×, 2×, 4× | Space bar = pause |

Moment to moment: watch the timeline, place or rearrange modules, change power priorities, plan engine burns and docking, and take contracts.

## 4. Systems

All values are starting points and live in `src/config/balance.js`. Tune them there; don't scatter magic numbers through the code.

### 4.1 Power

- Solar panels make power only in sunlight. Output = base × sun-facing factor (0–1).
- Fixed panels: cheap, about 60% average efficiency. Tracking panels: turn to follow the sun for about 95% efficiency, but add drag (see Altitude).
- Batteries store charge and drain during eclipses.
- Priority list: when demand is higher than supply, modules shut down from lowest priority up. The player sets the order.
- A module with no power goes offline and produces nothing, but it can still be holding heat.

### 4.2 Heat

- Every powered module makes heat each second. The sun adds heat to the station during the sunlit portion.
- Radiators get rid of heat only when they face away from the sun; one facing the sun works at about 20%.
- Each module has a temperature. Above **warn**, it works at reduced output. Above **max**, it shuts down and takes damage.
- Heat travels between connected modules through coolant loops (simple: average toward neighbors at a set rate).

### 4.3 Altitude (orbit decay)

- The station starts at 400 km. Thin air drag lowers it continuously.
- Drag ∝ station cross-section (bigger and more solar wings = faster decay).
- Reboost burn: spends fuel to gain altitude. Fuel cost ∝ total station mass.
- If the station's mass is unbalanced, burns push it off course and need extra correction fuel.
- Below 300 km: warning. Below 250 km: game over (the station burns up in the atmosphere).

### 4.4 Docking

- Supply ships arrive in announced windows (shown on the timeline 2–3 orbits ahead).
- To dock, a ship needs: a free docking port, enough power for the docking systems, and station temperature below a limit.
- A missed window means the ship waits one orbit, then leaves.
- Ships deliver fuel, spare parts, crew changes and contract cargo.

### 4.5 Crew (milestone 3)

- Each crew member uses air, food and power, and gives off heat.
- Assigning crew to a module boosts its output.
- Morale drops from blackouts, overheating and overwork, and makes crew less productive.

## 5. Modules

| Module | Power | Heat | Mass | Purpose |
| --- | --- | --- | --- | --- |
| Core hub | −2 | 2 | 10 | Starting piece, 6 attachment points |
| Truss segment | 0 | 0 | 2 | Extends the frame, 2–4 attachment points |
| Solar wing (fixed) | +8 sun / 0 shadow | 0 | 3 | Power |
| Solar wing (tracking) | +12 sun / 0 shadow | 0 | 4 | More power, more drag |
| Battery bank | stores 100 | 1 when charging | 5 | Gets you through eclipses |
| Radiator wing | −1 | −6 (removes) | 3 | Heat removal, must face away from the sun |
| Habitat | −3 | 3 | 12 | Crew housing (milestone 3) |
| Research lab | −6 | 5 | 10 | Earns credits from contracts |
| Furnace | −12 | 12 | 14 | Manufacturing, profitable but hard to run |
| Docking port | −1 (−4 while docking) | 1 | 4 | Lets supply ships dock |
| Fuel tank | 0 | 0 | 6 + fuel | Holds fuel for burns |
| Engine | −2 during burn | 4 during burn | 6 | Reboost and course correction |

**Placement rules:** modules snap to attachment points. Nothing can overlap. Radiators and solar wings sweep through space as the station rotates, so they can't block each other.

## 6. Contracts and economy (milestone 2)

The player earns credits by completing contracts and spends them on modules.

- **Research:** keep a lab powered and below the warn temperature for N straight orbits.
- **Manufacturing:** run a furnace for N seconds total and deliver the output to a supply ship.
- **Tourism (milestone 3):** host guests for N orbits with no blackout.
- **Satellite deploy:** release a payload within a set window in the orbit.

Contracts show reward, deadline and requirements up front. Failing one costs reputation, which lowers the reward on later contracts.

## 7. Events (milestone 3)

Every event is announced on the timeline before it happens (pillar 3).

- **Debris warning:** spend fuel on a dodge burn, or accept an X% chance of damage to a random module.
- **Solar storm:** a power surge, crew have to shelter, and unshielded electronics may be damaged.
- **Late ship:** an arrival slips by one orbit.

## 8. Win, lose, progression

- **Lose:** altitude below 250 km, the core hub loses all power for 2 full orbits, or (milestone 3) all crew are evacuated.
- No single win state. Sandbox with goals: reach credit milestones, finish contract chains, survive N orbits.
- Possible scenario mode later with set starting stations and goals.

## 9. Look and feel

- **Planet:** a large sphere filling the bottom of the view. Clear day/night line, city lights on the night side, a thin glow at the atmosphere's edge. It spins slowly under the station.
- **Lighting:** one directional "sun" light. The station casts real shadows on itself. Light goes warm/white in sunlight and fades to a dim blue fill light in eclipse, with a short transition at sunrise and sunset.
- **Station:** clean, slightly low-poly shapes made from basic geometry (boxes, cylinders) at first. Readable silhouettes matter more than detail.
- **Camera:** orbit controls around the station (drag to rotate, scroll to zoom). Keys 1–4 jump to preset angles.
- **Heat-map view (H key):** modules tinted blue → red by temperature.
- **Interface:** minimal and translucent.
  - Top: orbit timeline showing the current position, upcoming sunrise and sunset, ship windows and events.
  - Right: power, heat, altitude and fuel gauges.
  - Bottom: module build bar.
  - Clicking a module opens its info panel (power, heat, temperature, priority, crew).

## 10. Tech stack and architecture

- **Rendering:** Three.js (`three@0.170.0`), with OrbitControls from its addons.
- **Language:** plain JavaScript as ES modules. No framework for the game itself.
- **Build:** Vite. Milestone 1 may be a single `index.html` loading Three.js from a CDN; split it into modules once it passes about 800 lines.
- **Interface:** plain HTML/CSS layered over the canvas, not drawn in the 3D scene.

### Simulation vs. rendering

- The simulation runs at a fixed **10 ticks per game second**, separate from the frame rate. Time controls change how many ticks run per real second.
- The simulation is pure data with no Three.js inside. Rendering reads simulation state and draws it. This keeps the simulation testable and makes saving easy.
- Every system is a function `update(state, dt)` that runs in a fixed order: **orbit → power → heat → altitude → docking → crew → contracts → events.**

### Suggested structure

```
src/
  main.js              # starts the game, main loop
  config/balance.js    # every tunable number
  sim/
    state.js           # game state shape + factory
    orbit.js           # orbit position, sunlit/eclipse, sun direction
    power.js
    heat.js
    altitude.js
    docking.js
    crew.js
    contracts.js
    events.js
  render/
    scene.js           # renderer, camera, lights, planet
    station.js         # builds/updates module meshes from state
    effects.js         # heat-map tint, atmosphere glow, sunrise flash
  ui/
    hud.js             # gauges
    timeline.js        # orbit timeline
    buildbar.js
    inspector.js       # module info panel
  data/modules.js      # module definitions (table in §5)
```

### Conventions

- Units in the simulation: seconds, km, kW (power), "heat units", kg-ish mass. Comment the unit on every value in `balance.js`.
- The game state must be plain data that can be saved as JSON (no class instances or Three.js objects inside).
- Name sim functions after what they do (`applyDrag`, `distributeHeat`), not with generic names like `tick2`.
- Any new mechanic adds its numbers to `balance.js` and a line to this brief.

## 11. Milestones

### Milestone 1: Playable core ← START HERE

Goal: find out whether the eclipse rhythm is fun.

- [ ] Planet with day/night line, rotating under the station
- [ ] 90 s orbit with sunlit/eclipse phases, plus moving sun light and shadows
- [ ] Core hub + 4 placeable modules: solar wing (fixed), battery, radiator, research lab
- [ ] Snap-to-attachment-point building
- [ ] Power system with a priority list
- [ ] Heat system with radiators that depend on which way they face
- [ ] Orbit timeline + power/heat gauges
- [ ] Pause and 1×/2×/4× speed
- [ ] Lose condition: core hub loses power for 2 orbits

**Done when:** a new player can build a small station, survive several eclipses, and lose in a way they understand if they ignore heat or batteries.

### Milestone 2: Altitude, docking, economy

Orbit decay + engine burns, fuel, docking ports + supply ships, contracts + credits, tracking solar panels, furnace, engine, fuel tank.

### Milestone 3: Crew and events

Crew, habitat, morale, debris, solar storms, late ships, tourism contracts.

### Milestone 4: Polish

Sound, tutorial, saving/loading (localStorage), scenario mode, performance pass.

## 12. Out of scope (don't build these)

- Combat, weapons, aliens
- Fully realistic orbital mechanics (no plane changes or transfer orbits; altitude is a single number)
- Multiplayer
- Spacewalk or first-person modes
- Procedural planets (one handmade planet is enough)

## 13. Open questions

- Should station rotation be player-controlled (aim radiators and panels manually) or automatic with per-module "facing modes"? Current lean: automatic, with per-module modes.
- Can modules be damaged and repaired in milestone 1, or only shut down? Current lean: shutdown only until milestone 2.
- How long should a typical session be? Target: 20–40 minutes.
