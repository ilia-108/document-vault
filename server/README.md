# Go API and OpenBao

The Go service implements authenticated document upload, immutable versions, search, original-file downloads and per-account encryption settings. It uses SQLite for email codes and sessions, an atomic JSON metadata store for documents, and one immutable disk object per version. The document store is intended for a single server process; its data directory is exclusively locked.

## Local setup

Go 1.25 or newer and OpenBao 2.7.2 are required. Docker is optional.

Start OpenBao in its own terminal:

```sh
yarn openbao:start
```

If the binary is elsewhere, set `BAO_BIN` to its absolute path. The native configuration binds to loopback and stores its Raft data in `.data/openbao`. Alternatively use `docker compose -f infra/openbao/compose.yaml up -d` for the container deployment.

Initialize and unseal the local instance, create the Transit key and issue a restricted application token:

```sh
yarn openbao:setup
```

The local-only setup stores initialization material in `.local/secrets/openbao-init.json` and a restricted token in `.local/secrets/openbao-app-token`, with owner-only permissions. These paths and all data are gitignored. The application never receives the root token. The application token expires after seven days; rerun setup to issue a replacement, then restart the API to load it. Production initialization, unseal, backup and token renewal require operator-managed credentials, TLS and an appropriate secret-delivery mechanism such as OpenBao Agent. Do not reuse the local one-share setup as a production deployment.

Start the API and frontend:

```sh
yarn dev:server
```

The UI runs at `http://127.0.0.1:3040`, the API at `127.0.0.1:3050`. The development runner discovers the local restricted token file automatically. `yarn dev` remains the independent read-only mock demonstration.

## Email sign-in

The sender interface, Resend SDK and code/session flow are adapted from [road-rules-trainer](https://github.com/domyshev-labs/road-rules-trainer), with Document Vault templates and additional atomic code consumption and account isolation.

Local development defaults to `EMAIL_MODE=log`: codes appear only in the API terminal; no messages are sent. For real delivery, provide `EMAIL_MODE=resend`, `RESEND_API_KEY` and a verified `EMAIL_FROM`. The application uses `github.com/resend/resend-go/v3` with a request context and timeout.

Codes contain six random digits, expire after ten minutes and permit at most five attempts. Sending is limited per email and source IP, with a one-minute cooldown. New codes invalidate earlier ones. Verification consumes the code atomically in the same transaction that creates the session. Code hashes use HMAC-SHA-256; only session token hashes are stored. Sessions expire after 30 days and use HttpOnly, SameSite cookies. Secure cookies default to enabled with real email delivery; local HTTP uses an explicit development configuration. Requests through an external proxy currently share its source-IP rate limit; forwarding headers are intentionally not trusted automatically.

`SESSION_SECRET` may supply at least 32 characters. Otherwise a random persistent secret is generated in the private data directory. `DOCUMENT_ALLOWED_EMAILS` optionally restricts sign-in to a comma-separated list. Accounts have independent documents and encryption preferences; knowing an identifier does not grant access. Version links require sign-in to the owning account and are not public sharing links.

## File encryption

- Default: encrypt new files; individual upload choices are disabled.
- A separate setting permits individual encryption choices.
- Once a document receives any encrypted version, every subsequent version must be encrypted, regardless of defaults or client requests. Earlier versions are preserved as originally stored.
- Every encrypted version uses a fresh random AES-256-GCM key and nonce. OpenBao Transit protects the version key using the application's named key. Only the wrapped key is stored with private metadata; no plaintext file key is persisted or returned to the browser.
- Version identity and snapshot metadata are authenticated as additional data. The metadata itself, including filenames, remains readable in the private metadata store.
- The original checksum covers plaintext original bytes. A separate internal checksum protects the stored object. Downloads verify the stored object, authenticate/decrypt it, verify the original checksum and size, then return those exact bytes.
- An unavailable or sealed OpenBao causes encrypted operations to fail closed. There is no fallback to saving plaintext.

The browser never receives encryption keys. Uploads are limited to 25 MiB and buffered in memory; plaintext multipart data is not staged to disk. This first implementation does not provide large-file streaming, collaborative sharing, a multi-node metadata database, or public deployment infrastructure.

## Configuration

See [`.env.example`](../.env.example). Environment variables must be exported before starting the service; no secret file is loaded into the frontend bundle. Runtime frontend configuration uses the same-origin `/api` proxy. `BAO_TOKEN_FILE` is preferred over putting tokens on a command line. `BAO_TRANSIT_MOUNT` and `BAO_TRANSIT_KEY` select an existing Transit key; the service does not create or rotate master keys.

Keep both the document data directory and OpenBao's persistent data backed up. Keep the unseal/recovery material separately protected. The SQLite authentication database uses WAL, so back it up through SQLite's consistent backup mechanisms rather than copying a live database file alone.

## Verification

```sh
yarn test:server
yarn lint:server
```

Server tests use captured email delivery, temporary storage and an HTTP OpenBao test double. To include the actual local Transit service:

```sh
TEST_BAO_ADDR=http://127.0.0.1:8200 \
TEST_BAO_TOKEN_FILE="$PWD/.local/secrets/openbao-app-token" \
yarn test:server
```

No test sends real email. Browser tests continue to use the isolated mock API and request interception for authentication/upload responses.
