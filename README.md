# hevy-cli

A zero-dependency CLI for the [Hevy](https://hevy.com) workout API. Returns JSON — great for AI agents, scripts, and personal analytics.

## Install

```bash
npm install -g hevy-cli
```

Or run directly:

```bash
npx hevy-cli <command>
```

## Auth

```bash
hevy auth <your-api-key>
```

Get your API key from the Hevy app under **Settings → API**. This saves it to `~/.hevy/config.json`. You can also set `HEVY_API_KEY` as an environment variable.

## Commands

```bash
hevy workouts [--limit N] [--page N]     # list workouts with full exercise/set detail
hevy workout <id>                         # single workout
hevy routines [--limit N] [--page N]     # list routines
hevy routine <id>                         # single routine
hevy exercises [--limit N] [--page N]    # list exercise templates
hevy exercise <id>                        # single exercise template
```

All output is JSON to stdout. Errors go to stderr with a non-zero exit code.

## Example

```bash
# Get your 5 most recent workouts and pull out names
hevy workouts --limit 5 | jq '[.workouts[] | {title, start_time}]'
```
