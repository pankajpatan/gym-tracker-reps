# Gym Tracker: Reps

An offline-first iOS workout logger built with React Native and Expo.

[View on the App Store](https://apps.apple.com/us/app/gym-tracker-reps/id6812232562)

This is a portfolio copy of the app's source code. It leaves out store assets and private project notes, and the release configuration is not included.

## What it does
- Log sets quickly during a workout, with routines and custom exercises
- Keep full workout history and progress charts, with no account needed
- Import workouts from CSV exports of other tracking apps
- Use a rest timer, plate calculator and muscle map
- Integrate with iOS features including notifications, Live Activities and Apple Health

## Tech stack
- **App:** React Native, Expo, TypeScript
- **Data:** SQLite through `expo-sqlite`, with schema migrations
- **Testing:** Jest

## Project structure
```text
src/db        Schema, migrations, queries and seed data
src/domain    App logic with no UI: sessions, progress, units, imports, timers
src/ui        Screens, components and hooks
```

Keeping the logic in `src/domain` lets it be tested without rendering the UI.

## Run it
```bash
npm install
npm test
npm run typecheck
npm run prebuild
```

A development build is needed for native modules: `npm start` runs Expo's dev client. Native iOS builds require an EAS or Xcode setup of your own.

Import tests that use real exported workout logs are not in this copy, because those files are other people's data.

## Credits
- Exercise data: [free-exercise-db](https://github.com/yuhonas/free-exercise-db) (Unlicense)
- Body map paths: `react-native-body-highlighter` (MIT, see `assets/body-paths.LICENSE`)
