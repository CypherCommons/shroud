# Shroud Wallet

⚠️ **Work in Progress** - This wallet is currently under active development.

A non-custodial, Bitcoin-only mobile wallet with support for Silent Payments (BIP-352).

## Related Projects

This wallet is built using the following sister repositories:

- **[BlueWallet](https://github.com/BlueWallet/BlueWallet)** - Original codebase was forked from BlueWallet
- **[silent-pay](https://github.com/Bitshala-Incubator/silent-pay)** - Core Silent Payments library implementing BIP-352 protocol
- **[shroud-indexer](https://github.com/CypherCommons/shroud-indexer)** - Indexer service for efficient Silent Payment transaction scanning

## Getting Started

### Prerequisites
- Node.js >= 22.13 (Expo SDK 57)
- npm
- Rust via [rustup](https://rustup.rs) (for the silent-payments JSI bridge)
- Android Studio with NDK 27.1 (for Android development)
- Xcode 26.4+ (for iOS development)

## BUILD & RUN IT

Please refer to the engines field in package.json file for the minimum required versions of Node and npm. It is preferred that you use an even-numbered version of Node as these are LTS versions.

To view the version of Node and npm in your environment, run the following in your console:

```
node --version && npm --version
```

* In your console:

```
git clone https://github.com/CypherCommons/shroud.git
cd shroud
npm install
```

No configuration is needed to run: each network ships its own indexer and Electrum server. To point the app somewhere else (your own indexer, say), copy `.env.example` → `.env`, set only the values you want to override, then reset the Metro cache with `npx expo start --clear`. EAS builds read the same variables from the EAS environment instead of `.env`, and published updates from the publisher's shell (see `RELEASE.md`).

### Networks

The wallet supports mainnet, testnet4 and signet, switchable at runtime under **Settings → Network → Bitcoin Network**. Testnet4 is currently switched off (`enabled: false` in `modules/network.ts`), so the picker offers mainnet and signet only; wallets already stored on testnet4 are left untouched, and setting the flag back to `true` restores it. Each network has its own silent-payment indexer, with a clearnet and a Tor (`.onion`) address, defined in `modules/network.ts`. To override one, set it in `.env`:

```
EXPO_PUBLIC_INDEXER_BASE_URL_MAINNET=...
EXPO_PUBLIC_INDEXER_BASE_URL_TESTNET4=...
EXPO_PUBLIC_INDEXER_BASE_URL_SIGNET=...
```

A blank value keeps the shipped default, and `EXPO_PUBLIC_INDEXER_BASE_URL` is still honoured as an alias for `EXPO_PUBLIC_INDEXER_BASE_URL_MAINNET`. A network whose indexer address is empty is shown in the picker but cannot be selected.

The Tor addresses are used when Tor is enabled, and can be overridden the same way: `EXPO_PUBLIC_INDEXER_ONION_URL` (mainnet), `EXPO_PUBLIC_INDEXER_ONION_URL_TESTNET4` and `EXPO_PUBLIC_INDEXER_ONION_URL_SIGNET`. A network only ever uses its own address, so one with none is reached over clearnet (or not at all in Tor-only mode).

Each network keeps a completely separate wallet, balance and transaction history; switching does not migrate anything between them.

Electrum only powers the regular-output branch, since silent payments go through the indexer. Default servers ship for every network: mainnet, testnet4 (`testnet.aranguren.org:52002`, TLS) and signet (`electrum.signet.shroudwallet.com:50002`, TLS). To use another, pick it under **Settings → Network → Change server**; the server you pick is remembered per network.

Please make sure that your console is running the most stable versions of npm and node (even-numbered versions).

* To run on Android:

You will now need to either connect an Android device to your computer or run an emulated Android device using AVD Manager which comes shipped with Android Studio. To run an emulator using AVD Manager:

1. Download and run Android Studio
2. Click on "Open an existing Android Studio Project"
3. Open the `android/build.gradle` file
4. Android Studio will take some time to set things up. Once everything is set up, go to `Tools` -> `AVD Manager`.
    * 📝 This option [may take some time to appear in the menu](https://stackoverflow.com/questions/47173708/why-avd-manager-options-are-not-showing-in-android-studio) if you're opening the project in a freshly-installed version of Android Studio.
5. Click on "Create Virtual Device..." and go through the steps to create a virtual device
6. Launch your newly created virtual device by clicking the `Play` button under `Actions` column

Once you connected an Android device or launched an emulator, run this:

```
npm run rust:build
npm run android
```

The above command will build the app and install it. Once you launch the app it will take some time for all of the dependencies to load. Once everything loads up, you should have the built app running.

* To run on iOS:

```
npm run rust:build
npx pod-install
npm start
```

`npm run rust:build` compiles the Rust silent-payments crate and writes `ios/RustJsiBridge.xcframework`, which the `RustJsiBridge` pod links against. Re-run it whenever you change Rust sources; the xcframework is gitignored and not committed.

In another terminal window within the Shroud folder:
```
npm run ios
```

`npm run android` and `npm run ios` build a development build with [expo-dev-client](https://docs.expo.dev/develop/development-builds/introduction/) and connect it to the Metro server started by `npm start`.

Mac Catalyst builds are not supported since the move to Expo SDK 57, which ships React Native core prebuilt for iOS.

* To generate the debug APK:

```bash
bash scripts/build-debug-apk.sh
```

## TESTS

```bash
npm run test
```

### Developer Community

The dev community lurks in a small corner of Discord [here](https://discord.gg/Rfyp2nRGj7) (say 👋, if you drop there from this readme).

Dev discussions predominantly happen via FOSS best practices, and by using Github as the Community Forum.

## License

MIT