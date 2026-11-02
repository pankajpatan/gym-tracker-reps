/**
 * src/domain/ and src/db/ are plain TypeScript: the db layer talks to a
 * structural database interface, never to `expo-sqlite` directly, so the real
 * schema and the real migration runner are exercised in-process against
 * `node:sqlite` — the same engine that ships on the device. No Expo preset,
 * no native mocks. If a test here needs one, something has leaked in.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
};
