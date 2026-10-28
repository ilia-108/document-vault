# Testing

All commands run through Yarn. Browser tests use the local mock API only.

- `yarn typecheck`: application, configuration, unit and browser test types.
- `yarn lint` and `yarn format:check`: source quality and formatting.
- `yarn test:unit`: query serialization, preferences, concurrency and checksum logic.
- `yarn test:mock:contract`: real HTTP contracts, immutable fixtures, exact binary downloads and pagination.
- `yarn test:ui`: browser workflows on isolated ports 3041/3046.
- `yarn test:a11y`: keyboard and axe checks for the library and version details.
- `yarn build`: production frontend build.

Human development uses 3040/3045 through `yarn dev`. Playwright starts its own servers and never reuses an existing process. Do not stop another task's server or test against a remote API.

The mock is read-only, deterministic and validates its static file manifest at startup. `scripts/create-demo-files.cjs` is an explicit fixture maintenance utility; it is never executed automatically. Review file bytes and expected checksum changes together.

Behavioral tests assert user behavior, requests, downloaded bytes and errors. They do not compare screenshots. Use request interception for corrupted content, delayed responses, missing resources and a new latest version. No production mutation endpoints or hidden test controls are needed.
