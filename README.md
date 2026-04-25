# piquote

A Pi extension package that replaces the default `working...` line (above the footer) with rotating tips/quotes from YAML.

Versioning uses CalVer: `YYYY.M.D` (for example `2026.4.25`).

## Install from git

Global install:

```bash
pi install git:github.com/rinaldo-rex/piquote
```

Project-local install:

```bash
pi install -l git:github.com/rinaldo-rex/piquote
```

Examples:

```bash
pi install git:github.com/rinaldo-rex/piquote
pi install https://github.com/rinaldo-rex/piquote
pi install git:git@github.com:rinaldo-rex/piquote.git
```

After installation, run `/reload` in Pi.

## Configuration

On install, `piquote` now auto-creates this file if missing:

- `~/.pi/agent/piquote/quotes.yaml`

It never overwrites an existing file.

Example content:

```yaml
tips:
  items:
    - text: "Use /plan first for larger tasks to keep changes predictable."

quotes:
  items:
    - text: "Simplicity is prerequisite for reliability."
      author: "Edsger W. Dijkstra"
```

You can also write it quickly with a heredoc:

```bash
mkdir -p ~/.pi/agent/piquote
cat > ~/.pi/agent/piquote/quotes.yaml <<'YAML'
tips:
  items:
    - text: "Use /plan first for larger tasks to keep changes predictable."

quotes:
  items:
    - text: "Simplicity is prerequisite for reliability."
      author: "Edsger W. Dijkstra"
YAML
```

## Commands

- `/piquote-reload` - reload YAML and preview one random message.
- `/piquote-style` - opens a modal selector for style.
- `/piquote-style [minimal-1|minimal-2|balanced]` - set style directly.

## Styles

- `minimal-1`: pulse indicator + static text
- `minimal-2`: pulse indicator + progress trail (`▱▱▱▱` ... `▰▰▰▰`)
- `balanced` (default): pulse indicator + typewriter reveal

## Behavior summary

- Source: `~/.pi/agent/piquote/quotes.yaml`
- Schema: `tips.items` + `quotes.items`
- Category choice: random each refresh
- Item choice: random within category
- Rotation interval: `seconds = clamp(chars / 8, 3..12)`
- In balanced mode, keeps each message visible for at least 2s after full typewriter reveal
- Missing/invalid config: warn once, fallback to `working...`

## Development layout

Extension source is at:

- `piquote/index.ts`

For local project testing without install, Pi can auto-load from:

- `.pi/extensions/piquote/`
