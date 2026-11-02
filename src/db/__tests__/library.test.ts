import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrate } from '../migrations';
import {
  createCustomExercise, createRoutine, deleteSession, editExercise, finishSession,
  insertExercise, logSet, recentSessions, routineLastTrained, searchExercises,
  sessionDetail, setsForSession, startSession,
} from '../queries';
import { parseArt, seedExercises, type SeedExercise } from '../seed';
import { openTestDatabase } from './sqliteAdapter';

const seed = JSON.parse(
  readFileSync(join(__dirname, '../../../assets/exercise-seed.json'), 'utf8'),
) as SeedExercise[];

type TestDb = ReturnType<typeof openTestDatabase>;

async function freshDb(): Promise<TestDb> {
  const db = openTestDatabase();
  await migrate(db);
  return db;
}

describe('the shipped seed', () => {
  it('gives every exercise a name, a primary muscle and instructions', () => {
    const noMuscle = seed.filter((e) => e.primary.length === 0);
    const noName = seed.filter((e) => !e.name.trim());
    expect(noMuscle).toHaveLength(0);
    expect(noName).toHaveLength(0);
    // Five dataset entries genuinely have none; CONTENT-LIBRARY.md writes them.
    expect(seed.filter((e) => !e.instructions).length).toBeLessThanOrEqual(5);
  });

  it('has no duplicate names', () => {
    expect(new Set(seed.map((e) => e.name)).size).toBe(seed.length);
  });
});

describe('seeding', () => {
  let db: TestDb;
  beforeEach(async () => { db = await freshDb(); });
  afterEach(() => db.close());

  it('inserts the library once and is safe to run on every launch', async () => {
    const first = await seedExercises(db, seed);
    expect(first.inserted).toBe(seed.length);

    const second = await seedExercises(db, seed);
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(seed.length);

    const rows = await db.getAllAsync<{ n: number }>('SELECT COUNT(*) AS n FROM exercise;');
    expect(rows[0]?.n).toBe(seed.length);
  });

  it('never collides with a custom exercise the user made first', async () => {
    await createCustomExercise(db, { name: seed[0]!.name });
    const report = await seedExercises(db, seed);
    expect(report.skipped).toBe(1);
  });

  it('keeps both muscle lists for the About tab', async () => {
    await seedExercises(db, seed.slice(0, 20));
    const row = await db.getFirstAsync<{ art_ref: string | null }>(
      'SELECT art_ref FROM exercise LIMIT 1;',
    );
    const art = parseArt(row?.art_ref ?? null);
    expect(art.primary.length).toBeGreaterThan(0);
  });

  it('survives a row with no art reference', () => {
    expect(parseArt(null)).toEqual({ primary: [], secondary: [] });
    expect(parseArt('not json')).toEqual({ primary: [], secondary: [] });
  });
});

describe('the picker', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await freshDb();
    await seedExercises(db, seed);
  });
  afterEach(() => db.close());

  it('finds an exercise however the query is punctuated', async () => {
    const results = await searchExercises(db, 'bench press barbell');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.name.toLowerCase().includes('bench'))).toBe(true);
  });

  it('puts the shortest name first, so the plain movement leads', async () => {
    const results = await searchExercises(db, 'squat');
    expect(results[0]?.name.length).toBeLessThanOrEqual(results.at(-1)!.name.length);
  });

  it('hides archived rows', async () => {
    const [first] = await searchExercises(db, 'squat');
    await db.runAsync('UPDATE exercise SET archived = 1 WHERE id = ?;', first!.id);
    const after = await searchExercises(db, 'squat');
    expect(after.find((r) => r.id === first!.id)).toBeUndefined();
  });
});

describe('custom exercises', () => {
  let db: TestDb;
  beforeEach(async () => { db = await freshDb(); });
  afterEach(() => db.close());

  it('renders in the picker exactly like a seeded one', async () => {
    await seedExercises(db, seed.slice(0, 50));
    await createCustomExercise(db, { name: 'Zercher Squat (Sandbag)', muscle: 'quadriceps' });
    const results = await searchExercises(db, 'zercher');
    expect(results[0]).toMatchObject({ name: 'Zercher Squat (Sandbag)', is_custom: 1 });
  });

  it('edits a custom exercise in place', async () => {
    const id = await createCustomExercise(db, { name: 'Sandbag Carry' });
    const same = await editExercise(db, id, { name: 'Sandbag Carry (Heavy)' });
    expect(same).toBe(id);
    const row = await db.getFirstAsync<{ name: string }>('SELECT name FROM exercise WHERE id = ?;', id);
    expect(row?.name).toBe('Sandbag Carry (Heavy)');
  });

  it('clones a seeded exercise rather than mutating it', async () => {
    const seedId = await insertExercise(db, { name: 'Barbell Bench Press - Medium Grip' });
    const cloneId = await editExercise(db, seedId, { name: 'Bench Press' });

    expect(cloneId).not.toBe(seedId);
    const clone = await db.getFirstAsync<{ name: string; is_custom: number }>(
      'SELECT name, is_custom FROM exercise WHERE id = ?;', cloneId,
    );
    expect(clone).toMatchObject({ name: 'Bench Press', is_custom: 1 });

    const original = await db.getFirstAsync<{ name: string; archived: number }>(
      'SELECT name, archived FROM exercise WHERE id = ?;', seedId,
    );
    expect(original).toMatchObject({ name: 'Barbell Bench Press - Medium Grip', archived: 1 });
  });

  // History must not be rewritten by a rename.
  it('leaves already-logged sets pointing at the exercise they were logged against', async () => {
    const seedId = await insertExercise(db, { name: 'Barbell Bench Press - Medium Grip' });
    const session = await startSession(db);
    await logSet(db, { sessionId: session, exerciseId: seedId, position: 1, weightKg: 80, reps: 5 });

    await editExercise(db, seedId, { name: 'Bench Press' });

    const sets = await setsForSession(db, session);
    expect(sets[0]?.exercise_id).toBe(seedId);
  });
});

describe('history — proving a finished workout is readable back', () => {
  let db: TestDb;
  beforeEach(async () => { db = await freshDb(); });
  afterEach(() => db.close());

  it('lists a finished session with its counts and volume', async () => {
    const bench = await insertExercise(db, { name: 'Bench Press (Barbell)' });
    const session = await startSession(db, { name: 'Push', startedAt: 1_000 });
    await logSet(db, { sessionId: session, exerciseId: bench, position: 1, weightKg: 60, reps: 10 });
    await logSet(db, { sessionId: session, exerciseId: bench, position: 2, weightKg: 60, reps: 8 });
    await logSet(db, { sessionId: session, exerciseId: bench, position: 3, weightKg: 20, reps: 10, type: 'warmup' });
    await finishSession(db, session, { endedAt: 4_000 });

    const [recent] = await recentSessions(db);
    expect(recent).toMatchObject({
      id: session, name: 'Push', sets: 3, exercises: 1, ended_at: 4_000,
    });
    expect(recent?.volume_kg).toBe(1080); // warm-up excluded: 600 + 480
  });

  it('hides a session that is still running', async () => {
    await startSession(db, { startedAt: 2_000 });
    expect(await recentSessions(db)).toHaveLength(0);
  });

  it('returns the newest first', async () => {
    const a = await startSession(db, { startedAt: 100 });
    await finishSession(db, a, { endedAt: 200 });
    const b = await startSession(db, { startedAt: 300 });
    await finishSession(db, b, { endedAt: 400 });
    expect((await recentSessions(db)).map((s) => s.id)).toEqual([b, a]);
  });

  it('reads every set of a past session back', async () => {
    const squat = await insertExercise(db, { name: 'Squat (Barbell)' });
    const session = await startSession(db);
    await logSet(db, { sessionId: session, exerciseId: squat, position: 1, weightKg: 100, reps: 5 });
    await finishSession(db, session);

    const detail = await sessionDetail(db, session);
    expect(detail).toHaveLength(1);
    expect(detail[0]).toMatchObject({ name: 'Squat (Barbell)', weight_kg: 100, reps: 5 });
  });

  it('counts a bodyweight set without inventing volume for it', async () => {
    const pullup = await insertExercise(db, { name: 'Pull Up' });
    const session = await startSession(db);
    await logSet(db, { sessionId: session, exerciseId: pullup, position: 1, reps: 12 });
    await finishSession(db, session);

    const [recent] = await recentSessions(db);
    expect(recent).toMatchObject({ sets: 1, volume_kg: 0 });
  });
});

describe('an empty workout is never saved', () => {
  let db: TestDb;
  beforeEach(async () => { db = await freshDb(); });
  afterEach(() => db.close());

  /**
   * The rule lives in the hook, but its consequence is a database fact worth
   * pinning: a routine must not report itself trained because someone opened
   * the app and put the phone down.
   */
  it('would report a routine as trained today if an empty session were saved', async () => {
    const routine = await createRoutine(db, 'Push');
    const session = await startSession(db, { routineId: routine, startedAt: 1_000 });

    // Saving it (what we deliberately do NOT do) makes the card lie.
    await finishSession(db, session, { endedAt: 1_100 });
    expect(await routineLastTrained(db, routine)).toBe(1_000);

    // Discarding it instead leaves no trace.
    await deleteSession(db, session);
    expect(await routineLastTrained(db, routine)).toBeNull();
    expect(await recentSessions(db)).toHaveLength(0);
  });

  it('keeps a session that holds only warm-up sets', async () => {
    const bench = await insertExercise(db, { name: 'Bench Press (Barbell)' });
    const session = await startSession(db);
    await logSet(db, { sessionId: session, exerciseId: bench, position: 1, weightKg: 20, reps: 10, type: 'warmup' });
    await finishSession(db, session);

    const [recent] = await recentSessions(db);
    expect(recent).toMatchObject({ sets: 1, volume_kg: 0 });
  });
});
