# Verifying Shroud for Android

Every Android release on [GitHub Releases](https://github.com/CypherCommons/shroud/releases) has three files:

| File | What it is |
| --- | --- |
| `shroud-<version>-universal.apk` | The app. It is the same build as the Google Play version, signed with Cypher Commons' own key. |
| `SHA256SUMS` | The SHA-256 checksum of the APK. |
| `SHA256SUMS.asc` | An OpenPGP signature of `SHA256SUMS`, made with the Shroud release key. |

Checking all three proves the APK is the file Cypher Commons released, unchanged. Shroud's builds aren't reproducible yet, so this doesn't prove the APK was built from the published source code.

## Fingerprints

Each release's notes repeat them. They should match everywhere you find them.

| | Fingerprint |
| --- | --- |
| Release key (OpenPGP, signs `SHA256SUMS`) | `TODO: release key fingerprint` |
| APK signing certificate, GitHub releases (SHA-256) | `75:E0:5E:0E:8E:39:9D:C8:55:93:B1:E1:52:D6:47:FE:73:93:AD:26:A2:2C:8D:7D:0A:CD:79:C5:E4:A0:AF:87` |
| APK signing certificate, Google Play installs (SHA-256) | `TODO: Play app signing certificate` |

The package name is `com.shroudwallet.app`.

## 1. Get the release key

```sh
gpg --keyserver hkps://keys.openpgp.org --recv-keys <release key fingerprint>
```

Or import [`contrib/release-keys/shroud-release.asc`](contrib/release-keys/shroud-release.asc) from this repository. Either way, check that the fingerprint `gpg` shows is the one above.

## 2. Check the signature on the checksums

```sh
gpg --verify SHA256SUMS.asc SHA256SUMS
```

Look for `Good signature from "Shroud Release Signing"` and the release key's fingerprint. A warning that the key "is not certified with a trusted signature" is normal unless you have certified it yourself; the fingerprint is what matters.

## 3. Check the APK against the checksums

```sh
shasum -a 256 --ignore-missing --check SHA256SUMS     # macOS
sha256sum --ignore-missing --check SHA256SUMS         # Linux
```

It should print `shroud-<version>-universal.apk: OK`.

## 4. Check the APK's signing certificate

With the Android SDK's `apksigner`:

```sh
apksigner verify --print-certs shroud-<version>-universal.apk
```

The `SHA-256 digest` must equal the GitHub releases certificate above. After the first install, Android itself refuses any update signed with a different certificate.

On the phone, the [AppVerifier](https://github.com/soupslurpr/AppVerifier) app checks an installed app against its package name and certificate. Give it `com.shroudwallet.app` and the matching certificate from the table.

## Installing with Obtainium

In [Obtainium](https://github.com/ImranR98/Obtainium), add the app with the URL `https://github.com/CypherCommons/shroud`. Obtainium installs the latest release and checks for new ones.

## Switching between Google Play and GitHub

Google Play installs are signed with Google's key and GitHub releases with Cypher Commons' key, so one can't update the other. To switch, back up your recovery phrase, uninstall Shroud, install the other version and restore your wallet. Uninstalling deletes the wallet from the phone; only the recovery phrase brings it back.
