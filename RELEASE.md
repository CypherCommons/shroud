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
   - **OTA updates** ignore `.env` files and take only the `EXPO_PUBLIC_*` variables in the
     environment of the command that publishes them. Publish under `eas env:exec <environment>` (see
     [OTA updates](#ota-updates)) so an update gets the same overrides as the builds it targets.

## Update signing key

OTA updates are signed; builds reject any update that is not.

- The certificate is committed at `certs/certificate.pem` (valid until 2036-09-27) and compiled into
  every release build.
- The private key is **not** in the repository. It must be kept in the team's password manager or
  vault. Anyone with the key can push code to every install, and a lost key means no more updates
  until a new build with a new certificate is in users' hands.
- `npm run ota:publish` and `npm run ota:rollback` take `--private-key <path to private-key.pem>`. They
  refuse a key that doesn't match the certificate, and they check every signature before uploading.
- The update server never sees the key, so someone who takes over the server can't make the app run
  code we didn't sign. They can withhold updates, and they can serve any update or roll-back ever
  signed for a runtime version, on any channel: signatures aren't tied to a channel and can't be
  revoked. Treat everything you sign as if it went to production, including preview updates and
  updates you later roll back. See `update-server/README.md`.
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
- Each build asks for updates on the `channel` of its profile in `eas.json`: `production`, `preview`
  (also the `simulator` profile) or `development`. EAS Build only sets that for EAS Update, so
  `scripts/eas-build-pre-install.sh` does it for our server. Builds made outside EAS ask for
  `production`. The channel doesn't change the runtime version (see `fingerprint.config.js`).
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

Publish to `preview` first, check it on a preview build, then publish to `production`. `eas env:exec`
runs the publish with the `EXPO_PUBLIC_*` variables of that EAS environment, the same ones its
store builds were made with:

```sh
eas env:exec preview 'npm run ota:publish -- --channel preview --message "..." \
  --private-key <key> --upload deploy@updates.shroudwallet.com:/srv/shroud-updates'
eas env:exec production 'npm run ota:publish -- --channel production --message "..." \
  --private-key <key> --upload deploy@updates.shroudwallet.com:/srv/shroud-updates'
```

- Publish from a clean checkout. The script refuses uncommitted changes unless you pass
  `--allow-dirty`, and signs the commit and message into the update's manifest.
- Leave out `--upload` to stage the files under `build/ota/stage` and look at them first. With it,
  the script first asks the server for the live update, and stops if the new one would be older
  (this machine's clock is behind): apps would ignore it.
- If the server's SSH key is restricted with rrsync, the upload target is
  `deploy@updates.shroudwallet.com:` (see `update-server/README.md`).
- Roll back to the code built into the app:
  `npm run ota:rollback -- --channel production --private-key <key> --upload deploy@updates.shroudwallet.com:/srv/shroud-updates`.
  Run it from the commit the builds were made from, or pass `--runtime-version-ios` and
  `--runtime-version-android`. It stops if the server has nothing live for those runtime versions,
  which usually means the wrong checkout.
- To go back to an earlier update, check out its commit and publish it again.
- The app checks for updates on every launch, downloads them in the background and applies them on
  the next launch. The check goes to `updates.shroudwallet.com` over the regular internet, including
  for users in Tor-only mode. The server keeps no access logs.
