import { migrate } from '../migrations';
import {
  addExerciseToRoutine, createRoutine, deleteRoutine, finishSession, insertExercise,
  listRoutines, logSet, removeRoutineExercise, renameRoutine, reorderRoutineExercises,
  routineExercises, routineLastTrained, startSession, updateRoutineExercise,
} from '../queries';
import { openTestDatabase } from './sqliteAdapter';

type TestDb = ReturnType<typeof openTestDatabase>;

describe('routines (F-1)', () => {
  let db: TestDb;
  let bench: number;
  let squat: number;
  let row: number;

  beforeEach(async () => {
    db = openTestDatabase();
    await migrate(db);
    bench = await insertExercise(db, { name: 'Bench Press (Barbell)' });
    squat = await insertExercise(db, { name: 'Squat (Barbell)' });
    row = await insertExercise(db, { name: 'Row (Barbell)' });
  });
  afterEach(() => db.close());

  // Routines are never capped.
  it('has no cap on routines', async () => {
    for (let i = 0; i < 25; i += 1) await createRoutine(db, `Routine ${i}`);
    expect(await listRoutines(db)).toHaveLength(25);
  });

  it('appends new routines in order', async () => {
    await createRoutine(db, 'Push');
    await createRoutine(db, 'Pull');
    expect((await listRoutines(db)).map((r) => r.name)).toEqual(['Push', 'Pull']);
  });

  it('keeps exercises in the order they were added', async () => {
    const id = await createRoutine(db, 'Push');
    await addExerciseToRoutine(db, id, bench);
    await addExerciseToRoutine(db, id, squat);
    expect((await routineExercises(db, id)).map((e) => e.name))
      .toEqual(['Bench Press (Barbell)', 'Squat (Barbell)']);
  });

  it('carries target sets and rest through', async () => {
    const id = await createRoutine(db, 'Push');
    await addExerciseToRoutine(db, id, bench, { targetSets: 5, restS: 180 });
    expect((await routineExercises(db, id))[0]).toMatchObject({ target_sets: 5, rest_s: 180 });
  });

  it('reorders by rewriting positions densely', async () => {
    const id = await createRoutine(db, 'Push');
    const a = await addExerciseToRoutine(db, id, bench);
    const b = await addExerciseToRoutine(db, id, squat);
    const c = await addExerciseToRoutine(db, id, row);

    await reorderRoutineExercises(db, id, [c, a, b]);

    const after = await routineExercises(db, id);
    expect(after.map((e) => e.id)).toEqual([c, a, b]);
    expect(after.map((e) => e.position)).toEqual([0, 1, 2]);
  });

  it('groups exercises into a superset (F-6)', async () => {
    const id = await createRoutine(db, 'Arms');
    const a = await addExerciseToRoutine(db, id, bench);
    const b = await addExerciseToRoutine(db, id, row);
    await updateRoutineExercise(db, a, { supersetGroup: 1 });
    await updateRoutineExercise(db, b, { supersetGroup: 1 });

    const grouped = await routineExercises(db, id);
    expect(grouped.map((e) => e.superset_group)).toEqual([1, 1]);
  });

  it('ungroups without touching anything else', async () => {
    const id = await createRoutine(db, 'Arms');
    const a = await addExerciseToRoutine(db, id, bench, { targetSets: 4 });
    await updateRoutineExercise(db, a, { supersetGroup: 1 });
    await updateRoutineExercise(db, a, { supersetGroup: null });

    expect((await routineExercises(db, id))[0])
      .toMatchObject({ superset_group: null, target_sets: 4 });
  });

  it('removes one exercise and leaves the rest', async () => {
    const id = await createRoutine(db, 'Push');
    const a = await addExerciseToRoutine(db, id, bench);
    await addExerciseToRoutine(db, id, squat);
    await removeRoutineExercise(db, a);
    expect((await routineExercises(db, id)).map((e) => e.name)).toEqual(['Squat (Barbell)']);
  });

  it('renames', async () => {
    const id = await createRoutine(db, 'Push');
    await renameRoutine(db, id, 'Push Day A');
    expect((await listRoutines(db))[0]?.name).toBe('Push Day A');
  });

  it('cascades its exercises when deleted', async () => {
    const id = await createRoutine(db, 'Push');
    await addExerciseToRoutine(db, id, bench);
    await deleteRoutine(db, id);
    expect(await routineExercises(db, id)).toHaveLength(0);
  });

  // Deleting a routine must not delete the training done under it.
  it('keeps past sessions when the routine is deleted', async () => {
    const id = await createRoutine(db, 'Push');
    const session = await startSession(db, { routineId: id });
    await logSet(db, { sessionId: session, exerciseId: bench, position: 1, weightKg: 60, reps: 10 });
    await finishSession(db, session);

    await deleteRoutine(db, id);

    const kept = await db.getFirstAsync<{ id: number; routine_id: number | null }>(
      'SELECT id, routine_id FROM session WHERE id = ?;', session,
    );
    expect(kept).toMatchObject({ id: session, routine_id: null });
    const sets = await db.getAllAsync('SELECT id FROM set_entry WHERE session_id = ?;', session);
    expect(sets).toHaveLength(1);
  });

  it('reports when a routine was last trained', async () => {
    const id = await createRoutine(db, 'Push');
    expect(await routineLastTrained(db, id)).toBeNull();

    const session = await startSession(db, { routineId: id, startedAt: 5_000 });
    await finishSession(db, session, { endedAt: 6_000 });
    expect(await routineLastTrained(db, id)).toBe(5_000);
  });

  it('ignores an unfinished session when reporting last trained', async () => {
    const id = await createRoutine(db, 'Push');
    await startSession(db, { routineId: id, startedAt: 9_000 });
    expect(await routineLastTrained(db, id)).toBeNull();
  });
});
