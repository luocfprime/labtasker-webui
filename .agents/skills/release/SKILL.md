---
name: release
description: Prepare or validate Labtasker WebUI release versions, artifacts, tags, or PyPI publication; not for routine frontend builds.
---

# Release Labtasker WebUI

Follow root `AGENTS.md` and `.agents/sops/releasing.md`. This is a single WebUI distribution,
not the three-package Labtasker workspace; do not copy its Worker/distributed test gate.

1. Establish the requested version and authorized stage: preparation, commit, tag, push,
   GitHub Release or publication. Authorization for preparation is not publication.
2. Inspect branch, remotes, tags and dirty work. Preserve unrelated changes.
3. Update the Python metadata/runtime and frontend manifest/lockfile versions together.
   Run `uv lock`, then `uv run python scripts/check_versions.py --tag vVERSION`.
4. Run the ordinary gate in `.agents/sops/development.md`. Verify wheel-from-sdist installation,
   bundled assets and no Node.js runtime dependency. Do not replace tested artifacts.
5. Write Labtasker-style user-facing release notes. Report compatibility actions precisely;
   do not invent release history or a version-only changelog.
6. Only when explicitly authorized, publish the matching GitHub Release. The workflow
   rechecks the gate and publishes through the protected `pypi` OIDC environment.
7. Report actual release/workflow URLs or explicitly state which external steps remain.
