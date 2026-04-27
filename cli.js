#!/usr/bin/env node
'use strict';

const { parseArgs } = require('util');
const path = require('path');
const os = require('os');
const fs = require('fs');

const HEVY_DIR = path.join(os.homedir(), '.hevy');
const CONFIG_PATH = path.join(HEVY_DIR, 'config.json');
const BASE = 'https://api.hevyapp.com/v1';

// ── Auth ──────────────────────────────────────────────────────────────────────

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}

function getApiKey() {
  return process.env.HEVY_API_KEY || loadConfig().api_key;
}

function requireApiKey() {
  const key = getApiKey();
  if (!key) die('No API key found. Run: hevy auth <api-key>');
  return key;
}

// ── API ───────────────────────────────────────────────────────────────────────

async function apiFetch(apiKey, path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v);
  }
  const res = await fetch(url, { headers: { 'api-key': apiKey } });
  if (!res.ok) die(`API error ${res.status}: ${res.statusText}`);
  return res.json();
}

async function fetchAllPages(apiKey, path, pageSize = 10) {
  const results = [];
  let page = 1;
  while (true) {
    const body = await apiFetch(apiKey, path, { page, pageSize });
    const key = Object.keys(body).find(k => Array.isArray(body[k]));
    results.push(...body[key]);
    if (page >= body.page_count) break;
    page++;
  }
  return results;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function out(data) {
  console.log(JSON.stringify(data, null, 2));
}

function die(msg, code = 1) {
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(code);
}

// ── Commands ──────────────────────────────────────────────────────────────────

const USAGE = `
hevy-cli — Hevy API CLI

Usage:
  hevy auth <api-key>                                       Save API key globally
  hevy workouts [--limit N] [--page N]                      List workouts
  hevy workout <id>                                         Get a single workout
  hevy routines [--limit N] [--page N]                      List routines
  hevy routine <id>                                         Get a single routine
  hevy exercises [--limit N] [--page N]                     List exercise templates
  hevy exercise <id>                                        Get a single exercise template

Environment:
  HEVY_API_KEY   API key (overrides ~/.hevy/config.json)
`.trim();

async function main() {
  const [,, cmd, ...rest] = process.argv;

  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(USAGE);
    return;
  }

  if (cmd === 'auth') {
    const key = rest[0];
    if (!key) die('Usage: hevy auth <api-key>');
    if (!fs.existsSync(HEVY_DIR)) fs.mkdirSync(HEVY_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...loadConfig(), api_key: key }, null, 2));
    process.stderr.write(`API key saved to ${CONFIG_PATH}\n`);
    return;
  }

  if (cmd === 'workouts') {
    const { values } = parseArgs({
      args: rest,
      options: {
        limit: { type: 'string', default: '20' },
        page: { type: 'string', default: '1' },
      },
    });
    const apiKey = requireApiKey();
    out(await apiFetch(apiKey, '/workouts', { page: values.page, pageSize: values.limit }));
    return;
  }

  if (cmd === 'workout') {
    const id = rest[0];
    if (!id) die('Usage: hevy workout <id>');
    const apiKey = requireApiKey();
    out(await apiFetch(apiKey, `/workouts/${id}`));
    return;
  }

  if (cmd === 'routines') {
    const { values } = parseArgs({
      args: rest,
      options: {
        limit: { type: 'string', default: '20' },
        page: { type: 'string', default: '1' },
      },
    });
    const apiKey = requireApiKey();
    out(await apiFetch(apiKey, '/routines', { page: values.page, pageSize: values.limit }));
    return;
  }

  if (cmd === 'routine') {
    const id = rest[0];
    if (!id) die('Usage: hevy routine <id>');
    const apiKey = requireApiKey();
    out(await apiFetch(apiKey, `/routines/${id}`));
    return;
  }

  if (cmd === 'exercises') {
    const { values } = parseArgs({
      args: rest,
      options: {
        limit: { type: 'string', default: '20' },
        page: { type: 'string', default: '1' },
      },
    });
    const apiKey = requireApiKey();
    out(await apiFetch(apiKey, '/exercise_templates', { page: values.page, pageSize: values.limit }));
    return;
  }

  if (cmd === 'exercise') {
    const id = rest[0];
    if (!id) die('Usage: hevy exercise <id>');
    const apiKey = requireApiKey();
    out(await apiFetch(apiKey, `/exercise_templates/${id}`));
    return;
  }

  die(`Unknown command: "${cmd}"\nRun "hevy --help" for usage.`);
}

main().catch(err => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
