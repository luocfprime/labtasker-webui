# Release SOP

## Preconditions

A maintainer must configure the `pypi` GitHub environment and the package's PyPI
Trusted Publisher for workflow `release.yml`. Use environment protection and branch
protection appropriate to the repository. The workflow's `required` job is the stable
branch-protection check; repository settings must enable it separately.

Do not publish merely to test packaging. Local verification does not require GitHub or
PyPI credentials and does not push commits, create tags, or upload distributions.

## Prepare

1. Update `pyproject.toml`, `src/labtasker_webui/__init__.py`,
   `frontend/package.json`, and `frontend/package-lock.json` together. Regenerate
   `uv.lock` for the changed project version. Use a new, unpublished version.
2. Update user-facing docs and write release notes explaining changes and migrations.
3. Run the ordinary gate in [development.md](development.md) from the repository root. This performs static/unit checks,
   a fresh frontend build, three-browser regressions, and package verification.
4. Review the diff and `git status`. Exclude `.labtasker/`, credentials, traces,
   node_modules, caches and local build output. Do not discard unrelated work.
5. Review and merge through the repository's normal process. Publishing requires
   explicit maintainer authorization.

`uv run python scripts/check_package.py` builds into a fresh temporary directory to avoid mixing stale versions.
`uv build --sdist` creates the source archive; a second `uv build` builds its wheel.
The smoke test installs that wheel into a clean environment and runs it with no Node.js
on PATH, checks frontend assets and a synthetic upstream connection. Temporary local
verification artifacts are removed afterwards.

## Publish

Create the matching `vVERSION` tag and publish its GitHub Release after approval.
The release workflow verifies all version declarations and tag equality, calls full CI,
and publishes only the resulting `python-dist` artifact after CI succeeds. The publishing
job uses OIDC in the `pypi` environment; no long-lived PyPI API token is needed.

Do not replace the tested artifact with a local rebuild during the publishing step.
Manually running CI builds downloadable artifacts but does not publish.

## Failure and recovery

- Validation failure: fix the defect and rerun checks; do not bypass failing jobs.
- OIDC/environment failure: check the owner/repository/workflow/environment publisher
  configuration. Do not solve it by committing an API token.
- Partial publish: inspect PyPI before retrying. Published files/versions are immutable;
  do not delete/recreate a tag to disguise a different artifact as the same release.
- Product regression after release: issue a corrected version. A maintainer may yank a
  broken version with an explanation. Users can temporarily pin the last known good
  version; do not overwrite their `.labtasker/` profile/token during rollback.

After publication, verify installation of the released version and record the actual
workflow/release URLs. Never claim publication solely because local packaging passed.

## Release-note style

Follow the Labtasker series: title the release `vVERSION`; use short `Add`, `Change`
and `Fix` bullets ending with periods, ordered by user impact. Describe user-visible
outcomes, not every internal test/refactor. Put an important compatibility notice first
only when users must act. Include a comparison link after the first published release.
Do not create a version-only changelog when no maintained changelog exists.
