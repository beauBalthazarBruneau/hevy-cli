#!/usr/bin/env node
'use strict';

require('dotenv').config();

const { parseArgs } = require('util');
const path = require('path');
const os = require('os');
const fs = require('fs');

const HEVY_DIR = path.join(os.homedir(), '.hevy');
const CONFIG_PATH = path.join(HEVY_DIR, 'config.json');

// DB path: env override → ~/.hevy/hevy.db
const DB_PATH = process.env.HEVY_DB_PATH || path.join(HEVY_DIR, 'hevy.db');

// Load API key: env var → ~/.hevy/config.json
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}
const config = loadConfig();

const Database = require('better-sqlite3');

function openDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  return db;
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS movements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      primary_muscle_group TEXT,
      secondary_muscle_groups TEXT,
      equipment TEXT,
      is_custom INTEGER NOT NULL DEFAULT 0,
      synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS hevy_workouts (
      id TEXT PRIMARY KEY,
      title TEXT,
      routine_id TEXT,
      description TEXT,
      start_time TEXT,
      end_time TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS hevy_workout_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_id TEXT NOT NULL REFERENCES hevy_workouts(id) ON DELETE CASCADE,
      movement_id TEXT REFERENCES movements(id),
      idx INTEGER NOT NULL,
      title TEXT,
      notes TEXT,
      superset_id TEXT
    );
    CREATE TABLE IF NOT EXISTS hevy_workout_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_exercise_id INTEGER NOT NULL REFERENCES hevy_workout_exercises(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      type TEXT,
      weight_kg REAL,
      reps INTEGER,
      distance_meters REAL,
      duration_seconds REAL,
      rpe REAL
    );
    CREATE TABLE IF NOT EXISTS hevy_routines (
      id TEXT PRIMARY KEY,
      title TEXT,
      folder_id TEXT,
      updated_at TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS hevy_routine_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      routine_id TEXT NOT NULL REFERENCES hevy_routines(id) ON DELETE CASCADE,
      movement_id TEXT REFERENCES movements(id),
      idx INTEGER NOT NULL,
      title TEXT,
      notes TEXT,
      superset_id TEXT,
      rest_seconds INTEGER
    );
    CREATE TABLE IF NOT EXISTS hevy_routine_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      routine_exercise_id INTEGER NOT NULL REFERENCES hevy_routine_exercises(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      type TEXT,
      weight_kg REAL,
      reps INTEGER,
      distance_meters REAL,
      duration_seconds REAL
    );
  `);
}

// ── Sync ──────────────────────────────────────────────────────────────────────

const API_KEY = process.env.HEVY_API_KEY || config.api_key;
const BASE = 'https://api.hevyapp.com/v1';
const HEADERS = { 'api-key': API_KEY };

async function fetchAllPages(path, pageSize) {
  const results = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${BASE}${path}?page=${page}&pageSize=${pageSize}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`${path} page ${page}: ${res.status} ${res.statusText}`);
    const body = await res.json();
    const key = Object.keys(body).find(k => Array.isArray(body[k]));
    results.push(...body[key]);
    if (page >= body.page_count) break;
    page++;
  }
  return results;
}

async function syncMovements(db) {
  log('Syncing exercise templates...');
  const templates = await fetchAllPages('/exercise_templates', 100);
  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO movements (id, title, type, primary_muscle_group, secondary_muscle_groups, equipment, is_custom, synced_at)
    VALUES (@id, @title, @type, @primary_muscle_group, @secondary_muscle_groups, @equipment, @is_custom, @synced_at)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title, type = excluded.type,
      primary_muscle_group = excluded.primary_muscle_group,
      secondary_muscle_groups = excluded.secondary_muscle_groups,
      equipment = excluded.equipment, is_custom = excluded.is_custom, synced_at = excluded.synced_at
  `);
  db.transaction(rows => {
    for (const t of rows) {
      upsert.run({
        id: t.id, title: t.title, type: t.type,
        primary_muscle_group: t.primary_muscle_group || null,
        secondary_muscle_groups: JSON.stringify(t.secondary_muscle_groups || []),
        equipment: t.equipment || null,
        is_custom: t.is_custom ? 1 : 0,
        synced_at: now,
      });
    }
  })(templates);
  log(`  → ${templates.length} exercise templates synced`);
}

async function syncWorkouts(db) {
  log('Syncing workouts...');
  const workouts = await fetchAllPages('/workouts', 10);
  const upsertW = db.prepare(`
    INSERT INTO hevy_workouts (id, title, routine_id, description, start_time, end_time, created_at, updated_at)
    VALUES (@id, @title, @routine_id, @description, @start_time, @end_time, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title, routine_id = excluded.routine_id, description = excluded.description,
      start_time = excluded.start_time, end_time = excluded.end_time, updated_at = excluded.updated_at
  `);
  const delEx = db.prepare(`DELETE FROM hevy_workout_exercises WHERE workout_id = ?`);
  const insEx = db.prepare(`
    INSERT INTO hevy_workout_exercises (workout_id, movement_id, idx, title, notes, superset_id)
    VALUES (@workout_id, @movement_id, @idx, @title, @notes, @superset_id)
  `);
  const insSet = db.prepare(`
    INSERT INTO hevy_workout_sets (workout_exercise_id, idx, type, weight_kg, reps, distance_meters, duration_seconds, rpe)
    VALUES (@workout_exercise_id, @idx, @type, @weight_kg, @reps, @distance_meters, @duration_seconds, @rpe)
  `);
  db.transaction(rows => {
    for (const w of rows) {
      upsertW.run({
        id: w.id, title: w.title || null, routine_id: w.routine_id || null,
        description: w.description || null, start_time: w.start_time || null,
        end_time: w.end_time || null, created_at: w.created_at || null, updated_at: w.updated_at || null,
      });
      delEx.run(w.id);
      for (const ex of (w.exercises || [])) {
        const exRow = insEx.run({
          workout_id: w.id, movement_id: ex.exercise_template_id || null,
          idx: ex.index, title: ex.title || null, notes: ex.notes || null, superset_id: ex.superset_id || null,
        });
        for (const s of (ex.sets || [])) {
          insSet.run({
            workout_exercise_id: exRow.lastInsertRowid, idx: s.index, type: s.type || null,
            weight_kg: s.weight_kg ?? null, reps: s.reps ?? null,
            distance_meters: s.distance_meters ?? null, duration_seconds: s.duration_seconds ?? null,
            rpe: s.rpe ?? null,
          });
        }
      }
    }
  })(workouts);
  log(`  → ${workouts.length} workouts synced`);
}

async function syncRoutines(db) {
  log('Syncing routines...');
  const routines = await fetchAllPages('/routines', 10);
  const upsertR = db.prepare(`
    INSERT INTO hevy_routines (id, title, folder_id, updated_at, created_at)
    VALUES (@id, @title, @folder_id, @updated_at, @created_at)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, folder_id = excluded.folder_id, updated_at = excluded.updated_at
  `);
  const delEx = db.prepare(`DELETE FROM hevy_routine_exercises WHERE routine_id = ?`);
  const insEx = db.prepare(`
    INSERT INTO hevy_routine_exercises (routine_id, movement_id, idx, title, notes, superset_id, rest_seconds)
    VALUES (@routine_id, @movement_id, @idx, @title, @notes, @superset_id, @rest_seconds)
  `);
  const insSet = db.prepare(`
    INSERT INTO hevy_routine_sets (routine_exercise_id, idx, type, weight_kg, reps, distance_meters, duration_seconds)
    VALUES (@routine_exercise_id, @idx, @type, @weight_kg, @reps, @distance_meters, @duration_seconds)
  `);
  db.transaction(rows => {
    for (const r of rows) {
      upsertR.run({
        id: r.id, title: r.title || null, folder_id: r.folder_id || null,
        updated_at: r.updated_at || null, created_at: r.created_at || null,
      });
      delEx.run(r.id);
      for (const ex of (r.exercises || [])) {
        const exRow = insEx.run({
          routine_id: r.id, movement_id: ex.exercise_template_id || null,
          idx: ex.index, title: ex.title || null, notes: ex.notes || null,
          superset_id: ex.superset_id || null, rest_seconds: ex.rest_seconds ?? null,
        });
        for (const s of (ex.sets || [])) {
          insSet.run({
            routine_exercise_id: exRow.lastInsertRowid, idx: s.index, type: s.type || null,
            weight_kg: s.weight_kg ?? null, reps: s.reps ?? null,
            distance_meters: s.distance_meters ?? null, duration_seconds: s.duration_seconds ?? null,
          });
        }
      }
    }
  })(routines);
  log(`  → ${routines.length} routines synced`);
}

// ── Query helpers ─────────────────────────────────────────────────────────────

function getWorkouts(db, { limit = 20, since } = {}) {
  let sql = `SELECT * FROM hevy_workouts`;
  const params = [];
  if (since) { sql += ` WHERE start_time >= ?`; params.push(since); }
  sql += ` ORDER BY start_time DESC LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params);
}

function getWorkoutById(db, id) {
  const workout = db.prepare(`SELECT * FROM hevy_workouts WHERE id = ?`).get(id);
  if (!workout) return null;
  const exercises = db.prepare(`SELECT * FROM hevy_workout_exercises WHERE workout_id = ? ORDER BY idx`).all(id);
  for (const ex of exercises) {
    ex.sets = db.prepare(`SELECT * FROM hevy_workout_sets WHERE workout_exercise_id = ? ORDER BY idx`).all(ex.id);
  }
  workout.exercises = exercises;
  return workout;
}

function getRoutines(db, { limit = 50 } = {}) {
  return db.prepare(`SELECT * FROM hevy_routines ORDER BY updated_at DESC LIMIT ?`).all(limit);
}

function getRoutineById(db, id) {
  const routine = db.prepare(`SELECT * FROM hevy_routines WHERE id = ?`).get(id);
  if (!routine) return null;
  const exercises = db.prepare(`SELECT * FROM hevy_routine_exercises WHERE routine_id = ? ORDER BY idx`).all(id);
  for (const ex of exercises) {
    ex.sets = db.prepare(`SELECT * FROM hevy_routine_sets WHERE routine_exercise_id = ? ORDER BY idx`).all(ex.id);
  }
  routine.exercises = exercises;
  return routine;
}

function getExercises(db, { search, muscle, limit = 100 } = {}) {
  let sql = `SELECT * FROM movements WHERE 1=1`;
  const params = [];
  if (search) { sql += ` AND title LIKE ?`; params.push(`%${search}%`); }
  if (muscle) { sql += ` AND primary_muscle_group = ?`; params.push(muscle); }
  sql += ` ORDER BY title LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params).map(r => ({
    ...r,
    secondary_muscle_groups: tryParse(r.secondary_muscle_groups, []),
  }));
}

function getStats(db) {
  return {
    workouts: db.prepare(`SELECT COUNT(*) as count FROM hevy_workouts`).get().count,
    routines: db.prepare(`SELECT COUNT(*) as count FROM hevy_routines`).get().count,
    exercises: db.prepare(`SELECT COUNT(*) as count FROM movements`).get().count,
    last_workout: db.prepare(`SELECT start_time FROM hevy_workouts ORDER BY start_time DESC LIMIT 1`).get()?.start_time ?? null,
  };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function tryParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

function out(data) {
  console.log(JSON.stringify(data, null, 2));
}

function log(msg) {
  process.stderr.write(msg + '\n');
}

function die(msg, code = 1) {
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(code);
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const USAGE = `
hevy-cli — Hevy API local cache + query tool

Usage:
  hevy auth <api-key>                                  Save API key to ~/.hevy/config.json
  hevy sync [--workouts] [--routines] [--exercises]   Sync from Hevy API (default: all)
  hevy workouts [--limit N] [--since YYYY-MM-DD]       List recent workouts
  hevy workout <id>                                    Get workout with exercises & sets
  hevy routines [--limit N]                            List routines
  hevy routine <id>                                    Get routine with exercises & sets
  hevy exercises [--search Q] [--muscle GROUP] [--limit N]  Search exercise templates
  hevy stats                                           Summary counts

Environment:
  HEVY_API_KEY   API key (overrides ~/.hevy/config.json)
  HEVY_DB_PATH   SQLite path (default: ~/.hevy/hevy.db)
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
    const existing = loadConfig();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...existing, api_key: key }, null, 2));
    log(`API key saved to ${CONFIG_PATH}`);
    return;
  }

  if (cmd === 'sync') {
    if (!API_KEY) die('HEVY_API_KEY is not set');
    const { values } = parseArgs({
      args: rest,
      options: {
        workouts: { type: 'boolean' },
        routines: { type: 'boolean' },
        exercises: { type: 'boolean' },
      },
    });
    const all = !values.workouts && !values.routines && !values.exercises;
    const db = openDb();
    if (all || values.exercises) await syncMovements(db);
    if (all || values.workouts) await syncWorkouts(db);
    if (all || values.routines) await syncRoutines(db);
    log('Sync complete.');
    return;
  }

  if (cmd === 'workouts') {
    const { values } = parseArgs({
      args: rest,
      options: {
        limit: { type: 'string', default: '20' },
        since: { type: 'string' },
      },
    });
    const db = openDb();
    out(getWorkouts(db, { limit: parseInt(values.limit, 10), since: values.since }));
    return;
  }

  if (cmd === 'workout') {
    const id = rest[0];
    if (!id) die('Usage: hevy workout <id>');
    const db = openDb();
    const result = getWorkoutById(db, id);
    if (!result) die(`Workout "${id}" not found`, 2);
    out(result);
    return;
  }

  if (cmd === 'routines') {
    const { values } = parseArgs({
      args: rest,
      options: { limit: { type: 'string', default: '50' } },
    });
    const db = openDb();
    out(getRoutines(db, { limit: parseInt(values.limit, 10) }));
    return;
  }

  if (cmd === 'routine') {
    const id = rest[0];
    if (!id) die('Usage: hevy routine <id>');
    const db = openDb();
    const result = getRoutineById(db, id);
    if (!result) die(`Routine "${id}" not found`, 2);
    out(result);
    return;
  }

  if (cmd === 'exercises') {
    const { values } = parseArgs({
      args: rest,
      options: {
        search: { type: 'string' },
        muscle: { type: 'string' },
        limit: { type: 'string', default: '100' },
      },
    });
    const db = openDb();
    out(getExercises(db, {
      search: values.search,
      muscle: values.muscle,
      limit: parseInt(values.limit, 10),
    }));
    return;
  }

  if (cmd === 'stats') {
    const db = openDb();
    out(getStats(db));
    return;
  }

  die(`Unknown command: "${cmd}"\nRun "hevy --help" for usage.`);
}

main().catch(err => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
