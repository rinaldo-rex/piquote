# piquote extension

Replaces Pi's default `working...` text (above the footer) with random tips/quotes while the agent is working.

## Behavior

- Reads config from: `~/.pi/agent/piquote/quotes.yaml`
- Schema: `tips.items` and `quotes.items`
- Picks category randomly each refresh (`tips` or `quotes`)
- Picks a random item inside that category
- Rotation interval: `seconds = clamp(chars / 8, 3..12)`
- If config is missing/invalid/empty: warns once, then falls back to `working...`

## Install

1. Copy this folder into Pi's extensions directory:
   - `~/.pi/agent/extensions/piquote/`
2. Install dependency:
   - `cd ~/.pi/agent/extensions/piquote && npm install`
3. Create config directory and file:
   - `mkdir -p ~/.pi/agent/piquote`
   - `cp ~/.pi/agent/extensions/piquote/quotes.yaml.example ~/.pi/agent/piquote/quotes.yaml`
4. In Pi, run `/reload`

## Optional command

- `/piquote-reload` - reloads YAML and previews one random message immediately.

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
