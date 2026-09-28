# How to make a release

Store builds, store submissions and over-the-air (OTA) updates all go through EAS. Run the commands
with `npx eas-cli@latest` (or a global `eas`).

## One-time setup

1. `eas login`, then `eas init` to link the project to the Expo organization. This adds `owner` and
   `extra.eas.projectId` to `app.json`.
2. Point expo-updates at the project: set `updates.url` in `app.json` to
   `https://u.expo.dev/<projectId>`, and add the same URL as `EXUpdatesURL` in
   `ios/Shroud/Supporting/Expo.plist` and as `expo.modules.updates.EXPO_UPDATE_URL` in
   `android/app/src/main/AndroidManifest.xml`. The URL is compiled into the app, so it has to be in
   place before the first store build.
3. Create the environment variables for the `development`, `preview` and `production` EAS
   environments: `EXPO_PUBLIC_INDEXER_BASE_URL` and, if used, `EXPO_PUBLIC_INDEXER_ONION_URL`
   (`eas env:create`). Builds and updates read them from EAS; `.env` is only for local development.

## Update signing key

OTA updates are signed; builds reject any update that is not.

- The certificate is committed at `certs/certificate.pem` (valid until 2036-09-27) and compiled into
  every build.
- The private key is **not** in the repository. It must be kept in the team's password manager or
  vault. Anyone with the key can push code to every install, and a lost key means no more updates
  until a new build with a new certificate is in users' hands.
- Signed commands take `--private-key-path <path to private-key.pem>`.

## Store builds

```sh
eas build --platform all --profile production
eas submit --platform ios --profile production
eas submit --platform android --profile production
```

- Production builds listen on the `production` update channel; `preview` and `development` builds
  listen on channels of the same name.
- Build numbers are managed by EAS (`appVersionSource: remote`) and increase automatically. The
  user-facing version is `MARKETING_VERSION` (iOS) and `versionName` (Android).
- Google Play does not accept an app's first upload through the API: upload the first AAB by hand in
  Play Console, then use `eas submit`.

## OTA updates

An update can only change JavaScript and assets, and only reaches builds with the same runtime
version. The runtime version is a fingerprint of everything native: `android/`, `ios/`, native
dependencies, the Rust crate and the codegen specs (see `fingerprint.config.js`). If a change moves
the fingerprint, it needs a new store build instead:

```sh
npx expo-updates fingerprint:generate --platform ios      # and --platform android
```

Publish to `preview` first, check it on a preview build, then publish to `production`:

```sh
eas update --channel preview --environment preview --message "..." --private-key-path <key>
eas update --channel production --environment production --message "..." --private-key-path <key>
```

- Staged rollout: add `--rollout-percentage=10`, then raise it with `eas update:edit`, or undo it
  with `eas update:revert-update-rollout`.
- Roll back: `eas update:rollback`, either to the previous update or to the one embedded in the
  build. It needs the private key too.
- The app checks for updates on every launch, downloads them in the background and applies them on
  the next launch. The check goes to Expo's servers over clearnet, including for users in Tor-only
  mode.
