# Low Orbit

A 3D space-station management game that runs in the browser. Build and run a station circling a planet, and get it through the next eclipse.

Read [BRIEF.md](BRIEF.md) first. It is the source of truth for what the game is and how it is built.

## Run it

```
npm install
npm run dev      # play at the address it prints
npm test         # simulation tests
npm run build    # static build in dist/
```

## Controls

| Input | Action |
| --- | --- |
| Drag / scroll | Look around / zoom |
| 1–4 | Camera presets |
| Z, X, C, V | Build solar wing, battery, radiator, lab |
| Click a glowing ring | Attach the chosen module |
| R | Turn a wing (while placing, or the selected one) |
| Click a module | Open its info panel |
| Delete | Remove the selected module |
| Space | Pause |
| H | Heat-map view |
| Esc | Leave build mode / deselect |

`node test/balance-check.mjs` prints how a few example stations fare, for tuning `src/config/balance.js`.

How the game looks (light strengths, colours, bloom, planet scale, heat-map colours) is tuned in `src/render/look.js`. It never affects the simulation.
