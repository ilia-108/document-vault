# Document Vault

A standalone document library with immutable version links, original-file previews and exact SHA-256 verification. The React frontend uses a replaceable entity adapter. A deterministic local mock API supplies the demonstration data; no production backend is included.

## Run locally

```sh
yarn install --frozen-lockfile
yarn dev
```

Open http://127.0.0.1:3040. The UI and mock API bind to loopback ports 3040 and 3045. `yarn dev` checks both ports before starting. Use Ctrl+C to stop both processes.

`public/runtimeConfig.js` provides `API_BASE_URL` and `MODE`. During development Vite proxies `/api` to the local mock. Production hosting must supply a corresponding API or reverse proxy and a SPA fallback for version URLs.

## Model

A document has a stable `documentId` and a changing `latestVersionId`. A version has its own `versionId`, immutable metadata snapshot, file descriptor and expected checksum. Equal file hashes do not merge distinct versions. Version links remain pinned when a newer version is published.

Checksums cover original file bytes. Local verification does not upload the selected file. Downloading verifies the response bytes before saving them. Metadata retrieval alone never marks a file as verified. Snapshot metadata is immutable by contract; its authorship and timestamp are not cryptographically attested.

The demonstration supports PDF, UTF-8 text and JSON previews. Other formats remain downloadable. There are no editing, upload, signing or document comparison workflows. Browser hashing buffers demonstration-size files in memory.

## Development

Read [TESTING.md](TESTING.md) for verification commands and isolated browser-test ports. `yarn build` produces `dist/`.

The mock API is under `/api/v1/documents`: `schema`, `search`, a document ID, its `versions`, a version ID and `content`. All file fixtures are local. No external account or service is required.
