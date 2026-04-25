# piquote extension

Replaces Pi's default `working...` text (above the footer) with random tips/quotes while the agent is working.

Versioning uses CalVer: `YYYY.M.D` (for example `2026.4.25`).

## Behavior

- On package install, creates `~/.pi/agent/piquote/quotes.yaml` from the example if missing (never overwrites existing file)

- Reads config from: `~/.pi/agent/piquote/quotes.yaml`
- Schema: `tips.items` and `quotes.items`
- Picks category randomly each refresh (`tips` or `quotes`)
- Picks a random item inside that category
- Rotation interval: `seconds = clamp(chars / 8, 3..12)`
- In balanced mode, keeps each message visible for at least 2s after full typewriter reveal
- If config is missing/invalid/empty: warns once, then falls back to `working...`

## Install

### Preferred: install as a Pi package from git

```bash
pi install git:github.com/rinaldo-rex/piquote
# or project-local
pi install -l git:github.com/rinaldo-rex/piquote
```

Then run `/reload` in Pi.

### Manual local extension install

1. Copy this folder into Pi's extensions directory:
   - `~/.pi/agent/extensions/piquote/`
2. Install dependency:
   - `cd ~/.pi/agent/extensions/piquote && npm install`
3. Create config directory and file:
   - `mkdir -p ~/.pi/agent/piquote`
   - `cp ~/.pi/agent/extensions/piquote/quotes.yaml.example ~/.pi/agent/piquote/quotes.yaml`
4. In Pi, run `/reload`

## Optional commands

- `/piquote-reload` - reloads YAML and previews one random message immediately.
- `/piquote-style` - opens a selector modal to choose visual style.
- `/piquote-style [minimal-1|minimal-2|balanced]` - set style directly via argument.

### Styles

- `minimal-1`: pulse indicator + static text
- `minimal-2`: pulse indicator + progress trail (`▱▱▱▱` ... `▰▰▰▰`)
- `balanced` (default): pulse indicator + typewriter reveal

## YAML format

```yaml
tips:
  items:
    - text: "Use /plan first for larger tasks to keep changes predictable."

quotes:
  items:
    - text: "Simplicity is prerequisite for reliability."
      author: "Edsger W. Dijkstra"
```
