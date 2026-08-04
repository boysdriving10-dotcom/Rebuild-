# BallOut

Location-based pickup basketball. Find nearby games, explore courts on the map, and start playing.

## Features (MVP)

- **Login / Create Account** — mock auth UI (no backend yet)
- **Home** — nearby pickup games with Join
- **Map** — interactive courts, search, court bottom sheet
- **Create Game** — court, date, time, max players, public/private
- **Profile** — avatar, username, games hosted/joined

## Run

```bash
npm install
npx expo start
```

Then open in Expo Go, iOS Simulator, or Android Emulator.

## Stack

- Expo SDK 57
- Expo Router (file-based navigation)
- react-native-maps
- TypeScript

## Project structure

```
src/
  app/           # Routes (auth + tabs)
  components/    # Reusable UI
  constants/     # Theme
  context/       # Mock auth
  data/          # Mock courts & games
  types/         # Shared types
```
