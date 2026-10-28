# Document Vault

Standalone React/TypeScript document library. Documents own immutable versions. A version references exact original file bytes and a fixed SHA-256 checksum.

- Keep all code, comments, interface text and repository documentation in English.
- Keep entity-specific API, types and version behavior inside `src/entities/documents` and the `documentVersions` store module. The Explorer core depends on an adapter and schema.
- Do not implement a production backend. `mock/` is a local read-only demonstration API.
- Never regenerate expected checksums during requests or startup. Verify fixtures against `mock/manifest.json`.
- Read `TESTING.md` before writing or running tests. Browser tests must use the local mock API only.
- API base URL comes from runtime configuration. Do not hardcode a deployment hostname.
- Do not commit or push unless the user explicitly requests that exact action. Never force push.
- Keep plans outside the repository.
