# Last Sniper

First-person sniper game (Three.js + Electron) with a solo mode against AI and LAN/Internet multiplayer.

**Download:** get the Windows installer (`LastSniper-Setup-x.y.z.exe`) from the [Releases](../../releases) page.
Windows SmartScreen may warn that the publisher is unknown (the installer is not code-signed): choose *More info → Run anyway*.

## Modes
- **Story** – five assassination contracts. Each opens with a **dossier**: a photo of the target, his description and what to look for. The city is crowded; a minimap circle shows roughly where he is. Find him among the pedestrians (a few decoys wear the same colour), shoot him — and the whole crowd panics while his bodyguards, on the street and on the rooftops, fire back **one at a time**. Kill them all (or survive 2½ minutes) to finish. Shooting a civilian costs points; three civilian casualties fail the contract. A slow-motion **bullet camera** follows your shot on the target. Bonus objectives (headshot, no civilian casualties, fast kill, no damage) earn up to three stars; progress unlocks the next contract.
- **Solo** – hold the central tower against enemy snipers, one at a time. Each new enemy is first reported on the minimap (bottom-left, orange "!"), then walks onto his rooftop or appears in a window and takes cover. When he stands up to aim at you, red arrows on screen and a red dot on the minimap show his direction; there is no laser or scope glint, you have to find him. The muzzle flash of his shot gives his position away. A body hit wounds him: he bleeds and, the first time, relocates to a new position. The next enemy comes after the current one is killed, a little farther away each time.
- **Team Deathmatch** – Blue (west rooftops) vs Red (east rooftops).
- **Free For All** – everyone for themselves.

## Controls
| Key | Action |
|---|---|
| WASD | Move |
| Space | Jump — clear a parapet and cross to a nearby rooftop (falls of more than ~3.5 m hurt, falling to the street is fatal) |
| Mouse | Look |
| Right mouse | Scope (hold) |
| Left mouse | Fire |
| Shift | Hold breath (scoped) / sprint |
| C or Ctrl | Crouch (toggle) |
| R | Reload |
| Z / mouse wheel | Scope zoom |
| PageUp / PageDown | Scope zero distance (100–500 m) |
| Tab | Scoreboard |
| Enter | Chat (multiplayer) |
| Esc | Pause |
| F11 | Fullscreen |

Bullets are simulated: they take time to travel (850 m/s) and drop with gravity.
Set the zero to the target distance (shown by the rangefinder in the scope), or hold over using the mil-dots.

## Multiplayer
1. The host clicks **HOST GAME** → **CREATE LOBBY**. The lobby shows the address to share (e.g. `192.168.1.9:27015`).
2. Friends click **JOIN GAME** and enter that address.
3. The host (admin) can change mode / score / time limits, swap teams, kick players and start or end the match.

Same Wi‑Fi / LAN: works directly (allow the app through Windows Firewall when asked).
Over the internet: the host forwards TCP port 27015 on their router, or everyone joins a virtual LAN such as Radmin VPN or ZeroTier and uses that IP.

A dedicated server can also run without the game: `node server/server.js 27015` (it prints the admin token).

## Building from source (Windows)
Textures, sky, character model and sounds are not stored in this repository; a script downloads them.
```bash
npm install
npm run assets       # downloads textures, sky HDRI, character model and gun sounds into assets/
npm start            # run the desktop app
npm run dist         # build the Windows installer into dist/
npm run dev          # test in a browser at http://localhost:5173/src/index.html
```

## Credits
- Textures and sky HDRI from [Poly Haven](https://polyhaven.com) (CC0).
- Pedestrian / target characters by [Quaternius](https://quaternius.com) (CC0), via [poly.pizza](https://poly.pizza).
- Gun recordings (Mosin-Nagant, SKS) from "Gunshot Sounds" on [OpenGameArt](https://opengameart.org/content/gunshot-sounds) (CC0), cut by `tools/slice-sounds.js`.
- Soldier character: "Soldier.glb" from the [three.js](https://github.com/mrdoob/three.js) examples (a Mixamo character). Mixamo characters may be used inside games but not redistributed as standalone assets, so the file is downloaded by `npm run assets` and is not part of this repository.
- Built with [three.js](https://threejs.org), [Electron](https://www.electronjs.org) and [ws](https://github.com/websockets/ws).
