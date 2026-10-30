# Deploying to the NAS

The app runs on a Synology Plus NAS under Container Manager, from the images CI
publishes to GHCR. Why it is set up this way: [architecture §8](architecture.md#8-deployment).

Commands below run over SSH on the NAS, in the project folder. DSM's Docker socket
belongs to root, so prefix them with `sudo` unless your user can reach it. If Container
Manager's Docker lacks the `docker compose` plugin, use `docker-compose` instead.

## Images

`.github/workflows/ci.yml` runs lint, typecheck and tests before building both images.
Only successful validation on `main` permits publication, including manual runs:

| Image | Tags |
|---|---|
| `ghcr.io/laurinnr/meal-planner-api` | `latest`, `sha-<short commit>` |
| `ghcr.io/laurinnr/meal-planner-web` | `latest`, `sha-<short commit>` |

## One-time setup

1. **Container Manager** installed from Package Center, SSH enabled
   (Control Panel → Terminal & SNMP). Check what you're working with:

   ```sh
   docker version && docker compose version
   ```

2. **Project folder** with the Compose file and its settings:

   ```sh
   mkdir -p /volume1/docker/meal-planner && cd /volume1/docker/meal-planner
   # copy docker/compose.yaml and docker/.env.example from the repo here, then:
   cp .env.example .env && chmod 600 .env
   # the API container's user (uid 1000) writes the nightly snapshots here
   mkdir snapshots && chown 1000:1000 snapshots
   ```

   Edit `.env`: `SITE_ADDRESS` (step 4), and `IMAGE_TAG=sha-<short commit>` from a
   revision whose **both image jobs succeeded**. Configure daily backups below.
   Nothing environment-specific lives in the images.

3. **Registry login**, if the GHCR packages are private. Create a classic personal
   access token with only `read:packages` (GHCR doesn't accept fine-grained tokens),
   then:

   ```sh
   docker login ghcr.io -u <github user>   # paste the token as the password
   ```

4. **A hostname.** Add a local DNS record on the UniFi gateway pointing a name (say
   `meals.home.arpa`) at the NAS's LAN address, and set `SITE_ADDRESS` to it. Phones
   on the UniFi VPN resolve it through the gateway too.

5. **First start**, then trust Caddy's CA. Caddy creates its internal CA on first
   start; copy the root out and install it on each device (iOS: install the profile,
   then enable it under Settings → General → About → Certificate Trust Settings;
   Android: Settings → Security → Encryption & credentials → Install a certificate →
   CA certificate):

   ```sh
   docker compose pull && docker compose up -d
   docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./meal-planner-ca.crt
   ```

   The CA lives in the `caddy-data` volume. Keep that volume, or every device has to
   trust a new root.

The app is then at `https://<SITE_ADDRESS>:8443` (DSM holds 443).

## Deploying

```sh
docker compose pull && docker compose up -d
docker compose logs migrate     # what the migration step did
docker compose ps               # api should be "healthy"
```

`up` runs the one-shot `migrate` service first, and the API starts only if it exits
successfully. The API never migrates on boot. Read new migrations in the pull request
before deploying them, because drizzle-kit's table-recreate migrations are easy to
skim past.

To select a release, or roll back, set `IMAGE_TAG=sha-<short commit>` in `.env` and
run the same deploy command. Confirm both image jobs for that revision succeeded;
`latest` can temporarily name different revisions if one image publication fails. Rolling back across a migration doesn't undo it. If a migration
was the problem, restore the database from before it (see below).

## Daily backups

The recovery point is the last successful daily backup. Losing later edits is
acceptable for this household app. `snapshot.js` uses SQLite's `VACUUM INTO` to write
`snapshots/app-<UTC time>.db` while the API is running and keeps the newest 14 copies.
It publishes the completed file by renaming it, so backup jobs must select only
`app-*.db`, never hidden `.partial` files. Do not copy the live `app.db` on its own.

1. In DSM Task Scheduler, create a daily user-defined script running as `root`:

   ```sh
   cd /volume1/docker/meal-planner && /usr/local/bin/docker compose exec -T api node dist/app/snapshot.js /snapshots
   ```

   Enable failure notifications. A second argument sets the number of retained
   copies. The API container must be running; a stopped container makes the task
   fail rather than silently creating a new database.
2. Use Hyper Backup to copy the completed snapshots **off the NAS**. Schedule the
   transfer after snapshot generation and check the backup task's own success and
   failure notifications. A successful local snapshot does not prove off-host delivery.
3. Keep the image tag used with the backup in your deployment notes. A pre-migration
   snapshot is useful before an upgrade; use the corresponding application version
   when rehearsing a restore or rolling back a migration.

### Check an off-host backup

Retrieve a selected backup from the off-host destination into `snapshots/`, ensure
UID 1000 can read it, and set its filename explicitly:

```sh
export RESTORE_FILE=app-20261031T033000Z.db  # choose an actual completed backup
```

Check a disposable restored copy using the SQLite driver already in the API image:

```sh
docker compose run --rm --no-deps -T --entrypoint node api \
  --input-type=module - "/snapshots/$RESTORE_FILE" <<'CHECK'
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
const restored = join(mkdtempSync(join(tmpdir(), 'restore-check-')), 'app.db');
copyFileSync(process.argv[2], restored);
const db = new Database(restored, { readonly: true, fileMustExist: true });
try {
  if (db.pragma('integrity_check', { simple: true }) !== 'ok' ||
      db.pragma('foreign_key_check').length !== 0) throw new Error('Invalid backup');
  console.table(db.prepare('select id, name from households limit 5').all());
} finally { db.close(); }
CHECK
```

Inspect known data from the backup's date. As recipes and plans are added, include a
representative read of those records. Integrity checks establish structural validity,
not that every expected record exists. A daily backup is normally older than the
live database: different current row counts are expected and are not a backup failure.
Rehearse this check after changing the backup task and periodically thereafter.

### Restore the application

First select and check the off-host backup above, and set `IMAGE_TAG` to the matching
application version. The following block stops the stack, stages and validates the
backup, then preserves the original database **including any WAL/SHM files** before
replacing it. It never removes the database volume. Migration and startup run only
if all previous commands succeed. Do not run another deploy or writer during recovery.

<!-- restore-command -->
```sh
(
  set -eu
  : "${RESTORE_FILE:?Set RESTORE_FILE to a checked backup filename}"
  docker compose down
  docker compose run --rm --no-deps -T --entrypoint node api \
    --input-type=module - "/snapshots/$RESTORE_FILE" /data <<'RESTORE'
import { constants, copyFileSync, existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
const [source, directory] = process.argv.slice(2);
const staged = join(mkdtempSync(join(directory, 'restore-')), 'app.db');
copyFileSync(source, staged, constants.COPYFILE_EXCL);
const db = new Database(staged, { readonly: true, fileMustExist: true });
try {
  if (db.pragma('integrity_check', { simple: true }) !== 'ok' ||
      db.pragma('foreign_key_check').length !== 0) throw new Error('Invalid backup');
  console.table(db.prepare('select id, name from households limit 5').all());
} finally { db.close(); }
const original = mkdtempSync(join(directory, 'before-restore-'));
for (const name of ['app.db', 'app.db-wal', 'app.db-shm']) {
  const path = join(directory, name);
  if (existsSync(path)) copyFileSync(path, join(original, name), constants.COPYFILE_EXCL);
}
console.log('Original recovery files preserved at', original);
rmSync(join(directory, 'app.db-wal'), { force: true });
rmSync(join(directory, 'app.db-shm'), { force: true });
renameSync(staged, join(directory, 'app.db'));
RESTORE
  docker compose run --rm --no-deps migrate
  docker compose up -d
)
```

If any command fails, leave the stack stopped and investigate; do not run `up` to
work around the failure. The original files remain in place or in the printed
`/data/before-restore-*` directory. Retain that complete directory until recovery has
been confirmed. In particular, do not delete an old WAL independently of its database.

After success, check `/api/ready` and inspect the expected data in the application.
Only then clean up the preserved original and staging directories. Verify daily
snapshot generation and off-host delivery resume. A healthy status alone does not
establish that the expected historical records were recovered.

## Existing rootless Podman volumes

The override gives `migrate` and `api` the same `keep-id` mapping. It does not change
ownership of data created under a previous mapping. For disposable local data, stop
the stack, identify its exact database volume, and recreate only that volume after
confirming its contents can be discarded. For data you need, first export a consistent
snapshot using the old mapping, retain the original volume, and restore into a fresh
volume using the new mapping. Verify recovery before removing the original. Do not
apply a recursive ownership change or `down -v` indiscriminately. Test this transition
on the actual rootless Podman host; Docker Compose syntax checks cannot prove it.

## Day to day

| What | Command |
|---|---|
| Logs | `docker compose logs -f api`, `docker compose logs caddy` |
| Health | `curl -k https://<SITE_ADDRESS>:8443/api/ready` |
| Stop / start | `docker compose down` / `docker compose up -d` (volumes survive `down`, not `down -v`) |
