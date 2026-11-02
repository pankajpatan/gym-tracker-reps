import { migrate } from '../migrations';
import {
  activeSession, deleteSession, finishSession, getSetting, insertExercise,
  findExerciseByName, logSet, previousSetsForExercise, recomputePrs, setSetting,
  setsForSession, startSession,
} from '../queries';
import { openTestDatabase } from './sqliteAdapter';

type TestDb = ReturnType<typeof openTestDatabase>;

async function freshDb(): Promise<TestDb> {
  const db = openTestDatabase();
  await migrate(db);
  return db;
}

describe('write path', () => {
  let db: TestDb;
  beforeEach(async () => { db = await freshDb(); });
  afterEach(() => db.close());

  it('finds a seeded exercise however the name is punctuated', async () => {
    await insertExercise(db, { name: 'Bench Press (Barbell)' });
    expect(await findExerciseByName(db, 'bench press - barbell')).toMatchObject({
      name: 'Bench Press (Barbell)',
    });
  });

  it('refuses two exercises with the same normalised name', async () => {
    await insertExercise(db, { name: 'Pull Up' });
    await expect(insertExercise(db, { name: 'pull-up!' })).rejects.toBeDefined();
  });

  // F-4: the session exists on disk before anything is logged into it.
  it('resumes an in-progress session after a force-quit', async () => {
    const exercise = await insertExercise(db, { name: 'Squat (Barbell)' });
    const session = await startSession(db, { name: 'Leg Day' });
    await logSet(db, { sessionId: session, exerciseId: exercise, position: 1, weightKg: 100, reps: 5 });

    // Force-quit: nothing is flushed, the process simply stops. A new launch
    // opens the same file and asks what is unfinished.
    const resumed = await activeSession(db);
    expect(resumed).toMatchObject({ id: session, name: 'Leg Day' });
    expect(await setsForSession(db, session)).toHaveLength(1);
  });

  it('reports no active session once one is finished', async () => {
    const session = await startSession(db);
    await finishSession(db, session);
    expect(await activeSession(db)).toBeNull();
  });

  it('stores a bodyweight set with a null weight, not a zero', async () => {
    const exercise = await insertExercise(db, { name: 'Pull Up' });
    const session = await startSession(db);
    await logSet(db, { sessionId: session, exerciseId: exercise, position: 1, reps: 7 });
    const [set] = await setsForSession(db, session);
    expect(set?.weight_kg).toBeNull();
    expect(set?.reps).toBe(7);
  });

  it('rejects a set carrying no measurement at all', async () => {
    const exercise = await insertExercise(db, { name: 'Plank' });
    const session = await startSession(db);
    await expect(
      logSet(db, { sessionId: session, exerciseId: exercise, position: 1 }),
    ).rejects.toBeDefined();
  });

  it('rejects an unknown set type', async () => {
    const exercise = await insertExercise(db, { name: 'Deadlift (Barbell)' });
    const session = await startSession(db);
    await expect(
      logSet(db, {
        sessionId: session, exerciseId: exercise, position: 1, reps: 5,
        type: 'dropset' as never,
      }),
    ).rejects.toBeDefined();
  });

  it('writes records on finish, and warm-ups never set one', async () => {
    const exercise = await insertExercise(db, { name: 'Overhead Press (Barbell)' });
    const session = await startSession(db);
    await logSet(db, { sessionId: session, exerciseId: exercise, position: 1, weightKg: 200, reps: 1, type: 'warmup', doneAt: 10 });
    await logSet(db, { sessionId: session, exerciseId: exercise, position: 2, weightKg: 60, reps: 5, doneAt: 20 });
    await finishSession(db, session);

    const prs = await db.getAllAsync<{ kind: string; value: number }>(
      'SELECT kind, value FROM pr WHERE exercise_id = ? ORDER BY kind;',
      exercise,
    );
    const weight = prs.find((p) => p.kind === 'weight');
    expect(weight?.value).toBe(60);            // not the 200kg warm-up
    expect(prs.map((p) => p.kind).sort()).toEqual(['e1rm', 'reps', 'volume', 'weight']);
  });

  // The reason PRs are recomputed from history rather than ratcheted upward.
  it('lowers a record when the session holding it is deleted', async () => {
    const exercise = await insertExercise(db, { name: 'Squat (Barbell)' });

    const light = await startSession(db);
    await logSet(db, { sessionId: light, exerciseId: exercise, position: 1, weightKg: 100, reps: 5, doneAt: 100 });
    await finishSession(db, light);

    const heavy = await startSession(db);
    await logSet(db, { sessionId: heavy, exerciseId: exercise, position: 1, weightKg: 140, reps: 3, doneAt: 200 });
    await finishSession(db, heavy);

    let pr = await db.getFirstAsync<{ value: number }>(
      "SELECT value FROM pr WHERE exercise_id = ? AND kind = 'weight';", exercise,
    );
    expect(pr?.value).toBe(140);

    await deleteSession(db, heavy);

    pr = await db.getFirstAsync<{ value: number }>(
      "SELECT value FROM pr WHERE exercise_id = ? AND kind = 'weight';", exercise,
    );
    expect(pr?.value).toBe(100);
  });

  it('cascades sets when a session is deleted', async () => {
    const exercise = await insertExercise(db, { name: 'Row (Barbell)' });
    const session = await startSession(db);
    await logSet(db, { sessionId: session, exerciseId: exercise, position: 1, weightKg: 70, reps: 8 });
    await deleteSession(db, session);

    const left = await db.getAllAsync('SELECT id FROM set_entry WHERE session_id = ?;', session);
    expect(left).toHaveLength(0);
  });

  it('keeps a record on the session that first set it', async () => {
    const exercise = await insertExercise(db, { name: 'Bench Press (Barbell)' });
    const session = await startSession(db);
    await logSet(db, { sessionId: session, exerciseId: exercise, position: 1, weightKg: 80, reps: 5, doneAt: 100 });
    await logSet(db, { sessionId: session, exerciseId: exercise, position: 2, weightKg: 80, reps: 5, doneAt: 900 });
    await finishSession(db, session);

    const pr = await db.getFirstAsync<{ achieved_at: number }>(
      "SELECT achieved_at FROM pr WHERE exercise_id = ? AND kind = 'weight';", exercise,
    );
    expect(pr?.achieved_at).toBe(100);
  });

  it('recomputes records idempotently', async () => {
    const exercise = await insertExercise(db, { name: 'Clean (Barbell)' });
    const session = await startSession(db);
    await logSet(db, { sessionId: session, exerciseId: exercise, position: 1, weightKg: 90, reps: 2, doneAt: 5 });
    await finishSession(db, session);

    const first = await recomputePrs(db, exercise);
    const second = await recomputePrs(db, exercise);
    expect(second).toEqual(first);

    const rows = await db.getAllAsync('SELECT * FROM pr WHERE exercise_id = ?;', exercise);
    expect(rows).toHaveLength(first.length);
  });

  it('upserts settings', async () => {
    expect(await getSetting(db, 'unit')).toBeNull();
    await setSetting(db, 'unit', 'kg');
    await setSetting(db, 'unit', 'lb');
    expect(await getSetting(db, 'unit')).toBe('lb');
  });
});

describe('the PREVIOUS column', () => {
  let db: TestDb;
  beforeEach(async () => { db = await freshDb(); });
  afterEach(() => db.close());

  it('reads the last finished session, not the one being logged', async () => {
    const exercise = await insertExercise(db, { name: 'Bench Press (Barbell)' });

    const old = await startSession(db, { startedAt: 100 });
    await logSet(db, { sessionId: old, exerciseId: exercise, position: 1, weightKg: 62, reps: 7, doneAt: 110 });
    await logSet(db, { sessionId: old, exerciseId: exercise, position: 2, weightKg: 62, reps: 7, doneAt: 120 });
    await finishSession(db, old, { endedAt: 200 });

    const current = await startSession(db, { startedAt: 300 });
    await logSet(db, { sessionId: current, exerciseId: exercise, position: 1, weightKg: 70, reps: 5, doneAt: 310 });

    expect(await previousSetsForExercise(db, exercise)).toEqual([
      { weightKg: 62, reps: 7 },
      { weightKg: 62, reps: 7 },
    ]);
  });

  it('omits warm-ups — the column is a target, not a record of everything', async () => {
    const exercise = await insertExercise(db, { name: 'Squat (Barbell)' });
    const session = await startSession(db, { startedAt: 100 });
    await logSet(db, { sessionId: session, exerciseId: exercise, position: 1, weightKg: 20, reps: 10, type: 'warmup', doneAt: 110 });
    await logSet(db, { sessionId: session, exerciseId: exercise, position: 2, weightKg: 100, reps: 5, doneAt: 120 });
    await finishSession(db, session, { endedAt: 200 });

    expect(await previousSetsForExercise(db, exercise)).toEqual([{ weightKg: 100, reps: 5 }]);
  });

  it('is empty for an exercise never logged before', async () => {
    const exercise = await insertExercise(db, { name: 'Hip Thrust (Barbell)' });
    expect(await previousSetsForExercise(db, exercise)).toEqual([]);
  });
});
