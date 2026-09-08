# Contributing

Read [AGENTS.md](AGENTS.md) for product boundaries and working agreements.
This repository follows the Labtasker series: uv-managed Python environments,
a frozen lockfile, Ruff formatting/linting, strict typing and explicit capability
boundaries. npm and Playwright cover the WebUI-specific frontend.

Use Python 3.11+ and Node.js 22 (`.nvmrc`). From the repository root:

```sh
npm ci --prefix frontend
npm --prefix frontend run build
uv sync --group dev --frozen
uv run pre-commit install
```

Building the frontend first makes assets available to the editable Python package.
Install browsers once, from `frontend/`, with
`npx playwright install chromium firefox webkit`.

- [Development and ordinary validation gate](.agents/sops/development.md)
- [UI and integration QA](.agents/sops/qa.md)
- [Release and rollback](.agents/sops/releasing.md)
- [WebUI specification and state ownership](docs/reference/specification.md)

## Pull requests

Explain the concrete problem, resulting behavior and actual validation. Include
behavioral regressions and screenshots for layout changes. Keep unrelated formatting
out of the diff. Do not attach private profiles, tokens or authenticated traces.

Use `uv lock` after Python dependency changes and commit the generated lockfile.
Commit npm manifest/lockfile changes together; use `npm ci` for ordinary installs.
CI and local development use the same frozen uv resolution.

Before merge or release preparation, run the ordinary gate in `.agents/sops/development.md`.
Configure the `required` CI job as a required branch-protection check in repository
settings; workflow files alone do not enable branch protection.
