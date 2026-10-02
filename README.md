# Operation: Juggernaut

A self-aware siege tank the size of a city block is rolling toward your command post. It does not stop.

Operation: Juggernaut is a turn-based hex wargame that runs in the browser. One huge machine, the **Juggernaut**, tries to destroy a command post defended by tanks, hovertanks, howitzers and infantry. It's a modern take on the classic microarmor board and computer wargames of the late '70s and '80s.

It's plain HTML, CSS and JavaScript, with no build step and no dependencies.

## Running it

Open `index.html` in a browser. That's all you need.

You can also serve the folder locally:

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765.

## Modes

| Mode | You play | Computer plays |
|---|---|---|
| **Hold the line** | The defense | The Juggernaut |
| **Be the Juggernaut** | The Juggernaut | The defense |
| **Hotseat** | Both sides, two players on one screen | — |

You can fight one of two Juggernauts:

- **J-3** is the standard scenario: 45 treads and 2 missiles, against 12 armor points and 18 infantry squads.
- **J-5** is the heavy variant: 60 treads and 6 missiles, against 20 armor points and 30 infantry squads.

Each battlefield is numbered. The same number always produces the same map of craters and rubble.

## How to play

### Objective

- **The Juggernaut** wins by destroying the Command Post. Any hit destroys it, and so does driving over it. It's a **total victory** if the Juggernaut also escapes off the east edge afterwards. If it's immobilized after destroying the Command Post, the result is a **marginal victory**.
- **The defense** wins by immobilizing the Juggernaut before the Command Post falls.

### Turn sequence

1. **Juggernaut moves.** It gets up to 3 hexes per turn, fewer as it loses treads.
   - Driving into armor **rams** it. The unit is destroyed, and the Juggernaut loses 1 tread (2 for a heavy tank).
   - Driving over infantry crushes one squad.
2. **Juggernaut fires.** Each weapon fires once and can combine with others on one target. Missiles are one-shot. AP guns can only hit infantry and the Command Post.
3. **Defense moves.**
4. **Defense fires.** Units can combine fire on one Juggernaut system.
5. **Hovertanks move again**, up to 3 MP, so they can shoot and then get out of range.

### Controls

- **Deploying:** pick a unit type in the side panel, then click hexes west of the dashed line. Click a placed unit to remove it. **Auto-deploy** builds a defense for you.
- **Moving:** click a unit with a green outline, then click a highlighted hex. Hover over a hex to preview the path.
- **Firing as the defense:** click units that can fire (green outline) to group them. Then choose a target system in the **Fire on the Juggernaut** panel. Each option shows the odds and the kill chance.
- **Firing as the Juggernaut:** click weapon boxes on the status sheet to group them, then click a target on the map. Hovering over a target shows the odds.
- **Hover** over any unit to see its stats and range.
- **Right-click** or **Esc** clears a selection.
- **Enter** ends the phase.

### Combat

Divide the attack strength by the defense strength, round down to odds, and roll a die:

| Die | 1:2 | 1:1 | 2:1 | 3:1 | 4:1 | 5:1 |
|---|---|---|---|---|---|---|
| 1 | – | – | – | – | D | X |
| 2 | – | – | – | D | X | X |
| 3 | – | – | D | X | X | X |
| 4 | – | D | X | X | X | X |
| 5 | D | X | X | X | X | X |
| 6 | X | X | X | X | X | X |

- **X** destroys the target.
- **D** disables it, so the unit skips its next turn. A second D destroys it. Infantry hit by a D lose one squad instead.
- The Juggernaut's systems ignore D results.
- Odds worse than 1:2 have no effect. Odds of 6:1 or better destroy the target automatically.
- **Tread attacks** are always rolled at 1:1, one unit at a time. A hit removes treads equal to that unit's attack strength.

### Units

| Unit | Attack | Range | Defense | Move | Cost |
|---|---|---|---|---|---|
| Heavy Tank | 4 | 2 | 3 | 3 | 1 |
| Missile Tank | 3 | 4 | 2 | 2 | 1 |
| Hovertank | 2 | 2 | 2 | 4 + 3 | 1 |
| Howitzer | 6 | 8 | 1 | 0 | 2 |
| Infantry | 1 per squad | 1 | 1 per squad | 2 | 3 squads per stack |
| Command Post | 0 | 0 | 0 | 0 | required |

| Juggernaut weapon | Attack | Range | Defense |
|---|---|---|---|
| Missile (one-shot) | 6 | 5 | 3 |
| Main Battery | 4 | 3 | 4 |
| Secondary | 3 | 2 | 3 |
| AP Gun | 1 | 1 | 1 |

**Terrain:** craters can't be entered. Rubble costs armor 2 MP and infantry 1 MP.

**Strategy tip:** knock out the missiles first, because they can hit the Command Post from 5 hexes away. Then put everything into the treads. Attacks at 1:1 give the most kills per point of attack.

## Saving

The game autosaves to your browser's `localStorage` after every move, every shot and every phase change. It never saves in the middle of an animation or during a computer turn.

To resume, reload the page and choose **Continue saved battle** from the menu. There is one save slot per browser, and it's cleared when the battle ends.

## Project layout

```
index.html        page shell, menu and rules dialog
css/style.css     layout and theme
js/hex.js         hex-grid math and seeded map generator
js/rules.js       unit, weapon and Juggernaut stats, and the combat results table
js/audio.js       synthesized sound effects (WebAudio, no audio files)
js/render.js      canvas renderer, animations and effects
js/game.js        game state, turn loop, human input, side panels, save/load
js/ai.js          computer players for both sides
```

The scripts are classic `<script>` tags rather than ES modules, which is why the game runs straight from `file://`. They share top-level globals, so the load order in `index.html` matters.

## Tuning

- **Unit and weapon stats** and the combat results table are at the top of `js/rules.js`.
- **Juggernaut AI:** `AI.scoreOgre` in `js/ai.js` scores possible end positions. It drives for the Command Post, rams valuable armor, and holds one missile in reserve for the Command Post.
- **Defense AI:** `AI.defFire` in `js/ai.js` attacks at 1:1 (`oddsGoal`), shoots the missiles first (`targetKinds`), and puts all remaining fire into the treads. These defaults were tuned with headless AI-vs-AI simulation. With them, the AI defense wins about 30% of games against the AI Juggernaut.

## Credits

A tribute to the classic microarmor board and computer wargames of the late '70s and '80s.
