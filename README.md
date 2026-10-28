# Document Vault

A private document library built around **immutable versions and exact original files**. Keep a history of a document, give individual versions optional names, open a stable version link, and verify its original bytes with SHA-256.

The project includes a React/TypeScript frontend, a Go API, email-code authentication through Resend, and file encryption backed by OpenBao Transit. A separate local mock API supports demonstrations and isolated browser tests.

## Contents

- [Features](#features)
- [Architecture and data model](#architecture-and-data-model)
- [Requirements](#requirements)
- [Run locally](#run-locally)
- [Configuration](#configuration)
- [Deploy on a Linux server](#deploy-on-a-linux-server)
- [Data, backups and upgrades](#data-backups-and-upgrades)
- [Verification](#verification)
- [Current limits](#current-limits)

## Features

- Search by document metadata, add structured filters, sort results and choose table columns.
- Preserve each version as a separate immutable file with its own identifier, metadata snapshot and original-file checksum.
- Optionally name a version, for example `Editorial review`, independently of the document title and filename.
- Preview PDF, UTF-8 text and JSON; download other formats as original files.
- Verify a local file in the browser without uploading it. Downloads also verify the original checksum and size before saving.
- Sign in with a six-digit email code. Accounts have separate documents, sessions and encryption preferences.
- Encrypt new files by default with AES-256-GCM. An independent setting controls whether individual uploads may override the default.
- Permanently require encryption for future versions once a document has any encrypted version. A client request or a change to workspace defaults cannot bypass this rule. Earlier versions remain as originally stored.
- Use light/dark themes and keyboard-accessible dialogs, tabs and controls.

## Architecture and data model

```text
Browser / React frontend
         |
         | Same-origin /api requests and HttpOnly session cookie
         v
Go API ---------------------------------> Resend (sign-in email)
  |                  |
  |                  +------------------> OpenBao Transit (key protection)
  v
Persistent data directory
  state.json         Document metadata, version descriptors, wrapped file keys
  objects/*.bin      One independently stored file per version
  auth/sessions.db   SQLite accounts, code hashes and session-token hashes
  auth/session-secret  Generated HMAC secret, unless supplied externally
```

The frontend's Explorer core consumes a schema and a replaceable entity adapter. Document-specific preview, history, upload and checksum behavior lives in `src/entities/documents`.

A **document** has a stable `documentId` and a changing `latestVersionId`. A **version** has a distinct `versionId`, version number, optional name, captured metadata and exact file bytes. Identical checksums do not merge versions. A version link remains pinned after another version is added; it requires the owning account's session and is not a public sharing link.

For each encrypted version, the API generates a new random file key and nonce. The file is encrypted locally in the API process; OpenBao protects the small file key with the application's named Transit key. Only the protected key is persisted. Users do not manage keys for individual files or versions, and encryption keys are never delivered to the browser.

The original SHA-256 covers plaintext file bytes. An additional internal checksum covers the stored object. Version metadata is authenticated as additional data for encrypted files, but filenames and metadata are not themselves encrypted. Checksums do not provide a digital signature or independently attest authorship or capture time. See [server/README.md](server/README.md) for implementation details.

## Requirements

| Component         | Requirement                                                                |
| ----------------- | -------------------------------------------------------------------------- |
| Frontend tooling  | Node.js 24+, Yarn Classic 1.22.22                                          |
| API               | Go 1.25+; SQLite is embedded through the pure-Go driver                    |
| Key management    | OpenBao 2.7.2, installed separately or run with Docker Compose             |
| Real email        | Resend API key and a verified sender domain/address                        |
| Public deployment | Linux host, HTTPS reverse proxy, persistent storage and service management |

Native API development targets macOS/Linux. Docker is optional and currently supplies OpenBao only; the repository does not include an all-in-one application container.

## Run locally

```sh
git clone git@github.com:ilia-go/document-vault.git
cd document-vault
yarn install --frozen-lockfile
```

### Full application: Go + OpenBao

1. In the first terminal, start an installed `bao` binary:

   ```sh
   yarn openbao:start
   ```

   If needed, set `BAO_BIN` to its absolute path. Alternatively run:

   ```sh
   docker compose -f infra/openbao/compose.yaml up -d
   ```

   Both options expose the local OpenBao API at `http://127.0.0.1:8200`.

2. In another terminal, initialize/unseal this **local development instance**, create the named key and issue a restricted application token:

   ```sh
   yarn openbao:setup
   ```

   The setup stores development initialization material and a restricted token under `.local/secrets/` with owner-only permissions. It does not print secrets. This one-share convenience setup is for local development; use operator-managed initialization and recovery for a deployed service.

3. Start the frontend and API:

   ```sh
   yarn dev:server
   ```

   Open **http://127.0.0.1:3040/documents**. The Go API listens on `127.0.0.1:3050`. The runner discovers the local OpenBao token file automatically.

4. Enter an email address and request a code. The default local `EMAIL_MODE=log` prints the code in the **API terminal** and sends no email. Enter it to open your own library, then add a document or a new version.

The frontend runner checks its ports and does not replace another process. Stop the development processes with Ctrl+C. A local OpenBao token expires after seven days; rerun setup and restart the API to load a replacement. OpenBao data persists across restarts; after restarting a sealed local instance, run setup again to unseal it.

### Mock demonstration

```sh
yarn dev
```

This runs the read-only fixture library at `http://127.0.0.1:3040`, with its mock API on `3045`. It does not require Go, OpenBao, email credentials or sign-in. Authenticated upload and encryption controls are available in full API mode. Do not run both frontend modes on the same port simultaneously.

## Configuration

[`.env.example`](.env.example) documents local settings. Variables must be exported into the API process; `.env` files are not automatically loaded. Never put secrets into `public/`, a `VITE_*` variable or a frontend build.

| Variable                  | Meaning                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `DOCUMENT_LISTEN`         | API address; defaults to `127.0.0.1:3050`                                                                       |
| `DOCUMENT_DATA_DIR`       | Persistent API data; defaults to `.data/documents`                                                              |
| `DOCUMENT_ALLOWED_ORIGIN` | Exact frontend origin for write requests; defaults to `http://127.0.0.1:3040`                                   |
| `EMAIL_MODE`              | `log` for local codes, `resend` for actual delivery                                                             |
| `EMAIL_FROM`              | Sender accepted by your verified Resend configuration                                                           |
| `RESEND_API_KEY`          | Server-only Resend credential; required in `resend` mode                                                        |
| `COOKIE_SECURE`           | `true` behind public HTTPS; defaults to true in Resend mode and false in local log mode                         |
| `SESSION_SECRET`          | Optional stable random secret of at least 32 characters; otherwise generated and persisted privately by the API |
| `DOCUMENT_ALLOWED_EMAILS` | Optional comma-separated sign-in allowlist; empty permits accounts with access to their own email               |
| `BAO_ADDR`                | OpenBao URL; HTTPS required except on loopback                                                                  |
| `BAO_TOKEN_FILE`          | Preferred path to restricted service credentials; takes precedence over `BAO_TOKEN`                             |
| `BAO_TOKEN`               | Alternative server-only OpenBao token                                                                           |
| `BAO_TRANSIT_MOUNT`       | Transit mount, default `transit`                                                                                |
| `BAO_TRANSIT_KEY`         | Existing named key, default `document-vault`                                                                    |

Example of real email delivery in an already configured shell:

```sh
export EMAIL_MODE=resend
export EMAIL_FROM='Document Vault <login@your-verified-domain.example>'
# Supply RESEND_API_KEY through your secret manager or protected environment file.
yarn dev:server
```

The browser reads `API_BASE_URL` and `MODE` from `/runtimeConfig.js`. Full mode uses `{ API_BASE_URL: '/api', MODE: 'server' }`; deployment must route that same-origin `/api` prefix to Go. No credential belongs in this public configuration.

## Deploy on a Linux server

This is a **single-host deployment**: one Go process and one writer for the document data directory. Nginx serves the static frontend over HTTPS and proxies the API. OpenBao may run separately. The examples require an administrator to adapt the domain, certificates, paths and credentials; publishing this repository does not deploy a service.

### 1. Build release artifacts

On the target Linux architecture, or in an equivalent build environment:

```sh
yarn install --frozen-lockfile
yarn build:server
mkdir -p build
CGO_ENABLED=0 go build -trimpath -o build/document-vault ./server/cmd/document-vault
```

`build:server` creates `dist/` with the full-API runtime configuration. A regular `yarn build` preserves the default mock configuration for demonstrations. The Go binary is self-contained; SQLite does not require a separate database server. Do not copy a macOS binary onto Linux. For a cross-build, explicitly set the appropriate `GOOS` and `GOARCH`.

### 2. Prepare OpenBao and email delivery

- Initialize a persistent OpenBao instance using your operational recovery/unseal procedure, and enable Transit.
- Create the `document-vault` key with `aes256-gcm96` and key export disabled. Preserve existing key material on upgrades; do not replace it with a fresh key.
- Apply [the application policy](infra/openbao/application-policy.hcl). The API needs encrypt/decrypt permissions, not a root token or key-management permissions.
- Deliver restricted credentials in an owner/group-protected token file, with a renewal/replacement procedure. The current API reads token files at startup; restart it after token replacement. OpenBao Agent or another operator-managed mechanism can handle credential lifecycle.
- Configure Resend with a verified sender, set `EMAIL_MODE=resend`, and supply its API key only to the Go process.
- Set `COOKIE_SECURE=true`, the exact HTTPS `DOCUMENT_ALLOWED_ORIGIN`, and an email allowlist if this is a restricted installation.

Do not use `yarn openbao:setup` as production provisioning. Its saved local root/unseal material and single recovery share are development conveniences.

### 3. Install files and the API service

Example first installation on a systemd Linux host:

```sh
sudo useradd --system --home-dir /var/lib/document-vault --shell /usr/sbin/nologin document-vault
sudo install -d -m 0755 /opt/document-vault/bin /opt/document-vault/web
sudo install -d -m 0750 -o root -g document-vault /etc/document-vault
sudo install -d -m 0700 -o document-vault -g document-vault /var/lib/document-vault
sudo install -m 0755 build/document-vault /opt/document-vault/bin/document-vault
sudo cp -a dist/. /opt/document-vault/web/
sudo install -m 0640 -o root -g document-vault infra/deploy/server.env.example /etc/document-vault/server.env
sudo install -m 0644 infra/deploy/document-vault.service /etc/systemd/system/document-vault.service
```

Edit `/etc/document-vault/server.env` with the actual domain, sender and server-only credentials. Deliver the restricted OpenBao token to the configured path, readable by the service account and inaccessible to other users. The sample environment deliberately has no usable email credential. Keep environment and token files outside the checkout and web root.

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now document-vault
sudo systemctl status document-vault
```

The [service example](infra/deploy/document-vault.service) runs as an unprivileged account, writes only to its data directory and sends logs to the journal.

### 4. Configure HTTPS and static hosting

Adapt [the Nginx example](infra/deploy/nginx.conf):

- Replace `docs.example.com` and the TLS certificate paths.
- Serve `/opt/document-vault/web` and proxy `/api/` to `127.0.0.1:3050` without removing the prefix.
- Keep the SPA fallback to `index.html` so a direct version URL works after a browser reload.
- Do not cache `/runtimeConfig.js`, authenticated API responses or version content in a shared cache.
- Set the request-body allowance above the 25 MiB file limit; the example allows 26 MiB including multipart overhead.

Validate the configuration with `nginx -t`, then reload Nginx. Run the API on loopback; it does not need to be publicly exposed. HTTPS is required for secure cookies and browser file verification outside localhost.

### 5. Check the installation

```sh
curl --fail http://127.0.0.1:3050/api/health
curl --include https://docs.example.com/api/v1/documents/schema
```

Health reports the process mode and whether key-provider configuration exists; it is not an end-to-end availability check of Resend or OpenBao. The unauthenticated document request should return `401`.

Then sign in through the browser, upload a named version, download it, compare its SHA-256, and reload its permanent URL. Verify that another account cannot access the same document. After an encrypted version exists, disabling the workspace default must not permit a plaintext next version.

## Data, backups and upgrades

Back up **both** the entire API data directory and OpenBao's persistent key material. Losing the protecting key makes encrypted versions unrecoverable. Recovery/unseal material must be separately protected.

For a straightforward consistent backup, stop the API, preserve its full data directory, take an operator-authorized OpenBao Raft snapshot, and restart the API after the backup is verified. If backing up SQLite while the API is running, use SQLite's supported online backup mechanism; copying only the live `.db` file is not sufficient in WAL mode. Store backups outside Git and outside the web root.

For upgrades:

1. Record the running revision and create a verified backup before replacing artifacts.
2. Build a new frontend and API binary; stop the API and replace application artifacts only.
3. Preserve `/var/lib/document-vault`, OpenBao data, existing key versions, session secret and service configuration.
4. Restart the API, reload static hosting as needed, and check an existing encrypted historical version as well as a new upload.

The current metadata format is versioned but has no general-purpose migration framework. Review release changes before upgrades or rollbacks. Keep the previous application artifacts with their corresponding backup.

## Verification

```sh
yarn typecheck
yarn lint
yarn format:check
yarn test:unit
yarn test:mock:contract
yarn test:ui
yarn test:server
yarn lint:server
yarn build:server
```

Browser tests start their own local mock servers on `3041`/`3046`; they never reuse another task's server or call a remote API. Server tests use captured email delivery and temporary storage. For the optional real local OpenBao test:

```sh
TEST_BAO_ADDR=http://127.0.0.1:8200 \
TEST_BAO_TOKEN_FILE="$PWD/.local/secrets/openbao-app-token" \
yarn test:server
```

Tests do not send real email. See [TESTING.md](TESTING.md) for the testing rules and [server/README.md](server/README.md) for authentication and cryptographic details.

## Current limits

- Files are limited to 25 MiB and buffered in memory; large-file streaming is not implemented.
- The document metadata store supports one API writer and is not a distributed database. SQLite is used for authentication, not as the document catalog database.
- No public sharing, collaborative permissions, editing of preserved versions, signatures, OCR or document-content comparison.
- Text search covers document metadata and the latest version, not the full contents of every historical file.
- Filenames and metadata are not encrypted at rest; original file content is encrypted according to the recorded version policy.
- Forwarded IP headers are not trusted automatically. Accounts behind the same reverse proxy currently share its source-IP code-request limit; the email-specific limit remains independent. Set an allowlist for a small private installation and review this limit before a larger rollout.
- The included OpenBao Compose/native configurations are for local development. TLS, recovery, backup and credential renewal for a deployed key service remain operator responsibilities.

`.data/`, `.local/`, environment files, keys, logs, database files and build outputs are excluded from Git. Commit only synthetic fixtures and non-secret examples. No real documents or credentials are required to build or test the project.
