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
- Node.js >= 20
- npm
- Android Studio (for Android development)
- Xcode (for iOS development)

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

make sure to copy .env.example → .env, set at least one indexer URL in `.env`, then reset metro cache with `npx react-native start --reset-cache`.

### Networks

The wallet runs on mainnet, testnet4 or signet, switchable at runtime under **Settings → Network → Bitcoin Network**. Each network needs its own silent-payment indexer:

```
INDEXER_BASE_URL_MAINNET=...
INDEXER_BASE_URL_TESTNET4=...
INDEXER_BASE_URL_SIGNET=...
```

`INDEXER_BASE_URL` is still honoured as an alias for `INDEXER_BASE_URL_MAINNET`. Networks with no indexer configured are shown in the picker but cannot be selected without one.

To reach an indexer over Tor, give each network its own `.onion` address: `INDEXER_ONION_URL` (mainnet, its original name), `INDEXER_ONION_URL_TESTNET4` and `INDEXER_ONION_URL_SIGNET`. A network only ever uses its own address, so one with none is reached over clearnet (or not at all in Tor-only mode).

Each network keeps a completely separate wallet, balance and transaction history; switching does not migrate anything between them.

Electrum only powers the regular-output branch, since silent payments go through the indexer. Default servers ship for mainnet and for testnet4 (`testnet.aranguren.org:52002`, TLS). Signet has none, so add one by hand under **Settings → Network → Change server** if you need the regular-output branch there. The server you pick is remembered per network.

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
npx react-native run-android
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
npx react-native run-ios
```
**To debug Shroud on the iOS Simulator, you must choose a Rosetta-compatible iOS Simulator. This can be done by navigating to the Product menu in Xcode, selecting Destination Architectures, and then opting for "Show Both." This action will reveal the simulators that support Rosetta.
**

* To run on macOS using Mac Catalyst:

```
npx pod-install
npm start
```

Open ios/Shroud.xcworkspace. Once the project loads, select the scheme/target Shroud. Click Run.

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