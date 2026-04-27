# hevy-cli

A command-line tool for syncing [Hevy](https://hevy.com) workout data to a local SQLite database and querying it — useful for AI agents, scripts, or personal analytics.

## Setup

```bash
npm install
```

Create a `.env` file:

```
HEVY_API_KEY=your_api_key_here
```

Get your API key from the Hevy app under **Settings → API**.

## Usage

### Sync data from Hevy

```bash
node cli.js sync                  # sync everything
node cli.js sync --workouts       # workouts only
node cli.js sync --routines       # routines only
node cli.js sync --exercises      # exercise templates only
```

### Query

```bash
node cli.js stats                              # summary counts
node cli.js workouts                           # last 20 workouts
node cli.js workouts --limit 5 --since 2026-01-01
node cli.js workout <id>                       # full workout with sets
node cli.js routines                           # all routines
node cli.js routine <id>                       # full routine with sets
node cli.js exercises --search squat           # search by name
node cli.js exercises --muscle chest           # filter by muscle group
```

All output is JSON, making it easy to pipe into other tools or use with AI agents.

### Install globally

```bash
npm install -g .
hevy sync
hevy stats
```

## Environment

| Variable | Description |
|----------|-------------|
| `HEVY_API_KEY` | Required for sync |
| `HEVY_DB_PATH` | SQLite path (default: `~/.hevy/hevy.db`) |

## Database

Data is stored in a local SQLite database with these tables:

- `movements` — exercise templates
- `hevy_workouts` / `hevy_workout_exercises` / `hevy_workout_sets`
- `hevy_routines` / `hevy_routine_exercises` / `hevy_routine_sets`
