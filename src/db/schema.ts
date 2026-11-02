/**
 * The schema, as DDL, in one place.
 *
 * Statements are exported individually so a later migration can reference the
 * exact text that created a table, and as `ALL_DDL` for the initial migration.
 * `SCHEMA_VERSION` is what `PRAGMA user_version` is set to once every migration
 * has run; it is the code's view of the schema, not the database's.
 */

export const SCHEMA_VERSION = 2;

export const CREATE_EXERCISE = `
CREATE TABLE exercise (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  name_norm TEXT NOT NULL,
  muscle TEXT,
  equipment TEXT,
  instructions TEXT,
  art_ref TEXT,
  is_custom INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0
);`;

export const CREATE_EXERCISE_INDEX = `
CREATE UNIQUE INDEX ux_exercise_norm ON exercise(name_norm);`;

export const CREATE_ROUTINE = `
CREATE TABLE routine (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  source TEXT,                                 -- 'user' | 'import'
  created_at INTEGER NOT NULL
);`;

/**
 * Added in migration 2. Undo has to remove exactly the routines its own import
 * created, and `source = 'import'` cannot distinguish two imports — scoping by
 * timestamp failed as soon as two happened in the same second.
 */
export const ADD_ROUTINE_IMPORT_BATCH = `
ALTER TABLE routine ADD COLUMN import_batch_id INTEGER REFERENCES import_batch(id);`;

export const CREATE_ROUTINE_EXERCISE = `
CREATE TABLE routine_exercise (
  id INTEGER PRIMARY KEY,
  routine_id INTEGER NOT NULL REFERENCES routine(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercise(id),
  position INTEGER NOT NULL,
  target_sets INTEGER,
  rest_s INTEGER,
  superset_group INTEGER
);`;

export const CREATE_IMPORT_BATCH = `
CREATE TABLE import_batch (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  file_hash TEXT NOT NULL UNIQUE,
  imported_at INTEGER NOT NULL,
  sessions INTEGER,
  sets INTEGER,
  routines INTEGER
);`;

export const CREATE_SESSION = `
CREATE TABLE session (
  id INTEGER PRIMARY KEY,
  routine_id INTEGER REFERENCES routine(id),
  name TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  note TEXT,
  import_batch_id INTEGER REFERENCES import_batch(id)
);`;

export const CREATE_SESSION_INDEX = `
CREATE INDEX ix_session_started ON session(started_at DESC);`;

/**
 * `ck_set_measured` is SPEC.md's "a set is only valid with (weight,reps) or
 * duration or distance", corrected by the fixtures: 281 of 1,922 rows in the
 * real Hevy export are bodyweight work with reps and NO weight. Requiring
 * weight alongside reps would reject every one of them. Reps alone is a set.
 */
export const CREATE_SET_ENTRY = `
CREATE TABLE set_entry (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercise(id),
  position INTEGER NOT NULL,
  superset_group INTEGER,
  weight_kg REAL,
  reps INTEGER,
  duration_s INTEGER,
  distance_m REAL,
  type TEXT NOT NULL DEFAULT 'normal',         -- normal|warmup|drop|failure
  rpe REAL,
  note TEXT,
  done_at INTEGER,
  CONSTRAINT ck_set_type CHECK (type IN ('normal', 'warmup', 'drop', 'failure')),
  CONSTRAINT ck_set_measured CHECK (
    reps IS NOT NULL OR duration_s IS NOT NULL OR distance_m IS NOT NULL
  )
);`;

export const CREATE_SET_ENTRY_INDEX = `
CREATE INDEX ix_set_ex_time ON set_entry(exercise_id, done_at DESC);`;

/**
 * `set_id` is ON DELETE SET NULL, which SPEC.md did not say and the write-path
 * tests forced. Deleting a session cascades its sets; a `pr` row still pointing
 * at one of those sets is a foreign key violation, and the DELETE fails rather
 * than cascading — so "deleting a session recomputes PRs" was impossible to
 * reach. SET NULL lets the cascade through, and the recompute that follows
 * rewrites the row with a live `set_id` anyway.
 */
export const CREATE_PR = `
CREATE TABLE pr (
  exercise_id INTEGER NOT NULL REFERENCES exercise(id),
  kind TEXT NOT NULL,                          -- weight|reps|volume|e1rm
  value REAL NOT NULL,
  set_id INTEGER REFERENCES set_entry(id) ON DELETE SET NULL,
  achieved_at INTEGER NOT NULL,
  PRIMARY KEY (exercise_id, kind)
);`;

export const CREATE_BODY_MEASURE = `
CREATE TABLE body_measure (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  value REAL NOT NULL,
  measured_at INTEGER NOT NULL
);`;

export const CREATE_SETTING = `
CREATE TABLE setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);`;

/**
 * Order matters: `session` references `import_batch`, and `routine_exercise`
 * references both `routine` and `exercise`.
 */
export const ALL_DDL: readonly string[] = [
  CREATE_EXERCISE,
  CREATE_EXERCISE_INDEX,
  CREATE_ROUTINE,
  CREATE_ROUTINE_EXERCISE,
  CREATE_IMPORT_BATCH,
  CREATE_SESSION,
  CREATE_SESSION_INDEX,
  CREATE_SET_ENTRY,
  CREATE_SET_ENTRY_INDEX,
  CREATE_PR,
  CREATE_BODY_MEASURE,
  CREATE_SETTING,
];
