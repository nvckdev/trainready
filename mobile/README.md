# Taper — native iOS/Android app

The Taper training engine, running **on the phone**. This is not a WebView wrapper: the same
pure-TypeScript engine that generates plans on the dashboard (`../engine`, symlinked in as
`./engine`) is bundled by Metro and executes on-device. Plans, goal checks, tissue constraints,
intensity distribution, and the evidence-honesty copy are all the real thing, generated locally.
Health data never leaves the device (AsyncStorage).

## Architecture

- **Expo SDK 57 / expo-router**, TypeScript, dark-only Night Instrument theme (`src/lib/theme.ts`).
- **Engine on-device**: `./engine` is a symlink to the repo's engine. Metro bundles it via the
  `@engine/*` tsconfig path alias. `metro.config.js` shims `node:fs`/`node:path` — every engine
  fs read is an OPTIONAL corpus lookup guarded by `existsSync`/try-catch, so on device those
  callers take their documented "corpus absent" fallbacks. Engine math is untouched.
- **Screens**: Today (session cards, done-marks, week brief) · Plan (goal check, volume targets,
  tissue why, weeks with time-in-zone strips) · Fitness (projected CTL curve) · Goal (on-device
  `generatePlan`).
- **Demo athlete** (`src/lib/demo.ts`): seeded on first launch, clearly labeled, so the app
  demonstrates a full 16-week periodized plan before any history import.

## Develop

```bash
cd mobile
npm install
npx expo start          # Expo Go or a dev client
npx tsc --noEmit        # typecheck (includes the engine via imports)
npx expo export --platform ios --output-dir dist-check   # bundle verification
```

## Ship to the stores (EAS)

Prereqs you must create yourself: an [Expo account](https://expo.dev), an
[Apple Developer Program](https://developer.apple.com/programs/) membership (US$99/yr), and a
[Google Play Console](https://play.google.com/console) account (US$25 once).

```bash
npm i -g eas-cli
eas login
eas init                        # links the project to your Expo account
eas build --platform ios --profile production      # cloud-builds the .ipa
eas build --platform android --profile production  # cloud-builds the .aab
eas submit --platform ios       # uploads to App Store Connect
eas submit --platform android   # uploads to Play Console
```

Identity is already configured in `app.json`: bundle id / package `com.taperrun.app`
(matches the taperrun.com domain recommendation), scheme `taper`, dark UI, brand icons and
splash generated from the repo's mark.

App Review notes worth writing in the submission:
- The app is fully functional offline; the demo athlete shows the complete product without an
  account (reviewers can generate a plan in under a minute).
- No account, no tracking, no data collection: training data is stored locally on-device.
- Medical-adjacent copy is deliberately hedged; the footer states it is not medical advice.

## Roadmap (post-v0.1)

1. History import: FIT file share-sheet import on device; Strava via the dashboard's OAuth
   broker (`/api/strava`) once multi-user auth lands.
2. Daily roll-forward of CTL/ATL between opens (engine/seed.ts is already portable).
3. Re-plan from actuals (engine/replan.ts) once executed sessions exist on-device.
4. Structured-workout export to watches (FIT/ZWO) — shared with the dashboard roadmap.
5. Push notifications for the morning brief (expo-notifications + the digest module).
