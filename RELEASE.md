# How to make a release

Store builds and submissions go through EAS, in the cloud or with `--local` on a Mac with Xcode and the
Android SDK. Run those commands with `npx eas-cli@latest` (or a global `eas`). Over-the-air (OTA)
updates come from our own server, `update-server/`, and are signed on the publisher's machine.

## One-time setup

1. `eas login`, then `eas init` to link the project to the Expo organization. This adds `owner` and
   `extra.eas.projectId` to `app.json`.
2. Deploy the update server at `https://updates.shroudwallet.com` (see `update-server/README.md`).
   That URL is compiled into the app (`updates.url` in `app.json`, `EXUpdatesURL` in
   `ios/Shroud/Supporting/Expo.plist`, `expo.modules.updates.EXPO_UPDATE_URL` in
   `android/app/src/main/AndroidManifest.xml`), so changing it takes a new store build.
3. Optional: every network ships its own indexer addresses in `modules/network.ts`. To override one,
   set the matching `EXPO_PUBLIC_INDEXER_*` variable (the names are in `.env.example`):
   - **Store builds** read it from the `development`, `preview` and `production` EAS environments
     (`eas env:create`).
   - **OTA updates** ignore `.env` files and take only the `EXPO_PUBLIC_*` variables exported in the
     shell that publishes them.

   An update should be published with the same overrides as the builds it targets.

## Update signing key

OTA updates are signed; builds reject any update that is not.

- The certificate is committed at `certs/certificate.pem` (valid until 2036-09-27) and compiled into
  every release build.
- The private key is **not** in the repository. It must be kept in the team's password manager or
  vault. Anyone with the key can push code to every install, and a lost key means no more updates
  until a new build with a new certificate is in users' hands.
- `npm run ota:publish` and `npm run ota:rollback` take `--private-key <path to private-key.pem>`. They
  refuse a key that doesn't match the certificate, and they check every signature before uploading.
- The update server never sees the key. Someone who takes over the server can withhold updates, but
  can't make the app run their code.
- Only release builds carry the certificate. Debug builds (development clients) leave it out, so they
  load unsigned manifests from Metro and nobody needs the key to develop.

## Store builds

```sh
eas build --platform ios --profile production --local       # without --local, EAS builds in the cloud
eas build --platform android --profile production --local
eas submit --platform ios --profile production
eas submit --platform android --profile production
```

- `--local` builds on this machine, one platform at a time.
- Production builds ask for updates on the `production` channel; `preview` and `development` builds ask
  for channels of the same name.
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
npm run ota:publish -- --channel preview --message "..." \
  --private-key <key> --upload deploy@updates.shroudwallet.com:/srv/shroud-updates
npm run ota:publish -- --channel production --message "..." \
  --private-key <key> --upload deploy@updates.shroudwallet.com:/srv/shroud-updates
```

- Publish from a clean checkout. The script refuses uncommitted changes unless you pass
  `--allow-dirty`, and records the commit in the update.
- Leave out `--upload` to stage the files under `build/ota/stage` and look at them first.
- Roll back to the code built into the app:
  `npm run ota:rollback -- --channel production --private-key <key> --upload deploy@updates.shroudwallet.com:/srv/shroud-updates`.
  Run it from the commit the builds were made from, or pass `--runtime-version-ios` and
  `--runtime-version-android`.
- To go back to an earlier update, check out its commit and publish it again.
- The app checks for updates on every launch, downloads them in the background and applies them on
  the next launch. The check goes to `updates.shroudwallet.com` over the regular internet, including
  for users in Tor-only mode. The server keeps no access logs.
