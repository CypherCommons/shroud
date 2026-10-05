# Shroud update server

Serves over-the-air updates to the app with the Expo Updates protocol (v1), in place of EAS Update. It's one dependency-free file, `server.mjs`.

## Why it can't ship code by itself

The server holds no signing key, has no database and accepts no uploads. It returns files from a read-only directory.

- `scripts/ota/publish.mjs` builds each update and signs its manifest on the publisher's machine. It uses the key from the vault, checks the signature against `certs/certificate.pem` and copies the result here over SSH.
- The app accepts only manifests signed by that key, and every downloaded file must match its hash in the manifest.

So someone who takes over the server can withhold updates or roll users back to the code built into the app, but can't make the app run their code. It also writes no access logs, because an update check reveals the user's IP address.

## Endpoints

| Path | Returns |
| --- | --- |
| `GET /manifest` | The current update for the request's `expo-platform`, `expo-runtime-version` and `expo-channel-name` (default `production`), or a signed roll-back directive. Returns 204 when there is nothing new. |
| `GET /assets/<sha256><ext>` | An update file. Files are named by their hash, so they are cached forever. |
| `GET /health` | `ok` |

## Data directory

The publish and rollback scripts write this tree; the server only reads it.

```
assets/<sha256 hex><ext>
updates/<id>/manifest.json + signature
directives/<id>/directive.json + signature
channels/<channel>/<runtime version>/<platform>.json   (the current pointer)
```

## Deploy

1. **DNS.** Point `updates.shroudwallet.com` at the server.
2. **Data directory.** Create `/srv/shroud-updates`, owned by a `deploy` user that publishers reach over SSH. For a tighter key, restrict it in that user's `authorized_keys` with `command="rrsync /srv/shroud-updates"`.
3. **Run the container** with the data directory mounted read-only:

   ```yaml
   # docker-compose.yml
   services:
     shroud-updates:
       build: ./update-server
       restart: unless-stopped
       read_only: true
       cap_drop: [ALL]
       security_opt: ["no-new-privileges:true"]
       volumes:
         - /srv/shroud-updates:/data:ro
       ports:
         - "127.0.0.1:3000:3000"
   ```

4. **TLS.** Terminate it in your reverse proxy, with access logs off:

   ```
   # Caddyfile
   updates.shroudwallet.com {
     reverse_proxy 127.0.0.1:3000
     log {
       output discard
     }
   }
   ```

5. **Check it.** `curl https://updates.shroudwallet.com/health` returns `ok`.

## Publish and roll back

From the repo root, with the key from the vault:

```sh
npm run ota:publish -- --channel production --message "Fix fee rounding" \
  --private-key <key> --upload deploy@updates.shroudwallet.com:/srv/shroud-updates

npm run ota:rollback -- --channel production \
  --private-key <key> --upload deploy@updates.shroudwallet.com:/srv/shroud-updates
```

Leave out `--upload` to stage the files under `build/ota/stage` and look at them first. `RELEASE.md` covers when an update can go out over the air and when it needs a store build.

## Test

```sh
npm run test:ota
```

To run it locally against a staged tree: `DATA_DIR=build/ota/stage PORT=3000 node update-server/server.mjs`.
