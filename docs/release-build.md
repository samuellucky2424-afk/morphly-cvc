# Windows Release Builds

Morphly's Windows installer must include the local Beatrice/w-okada backend. That backend is hundreds of MB, so it is packaged as `build/backend-payload.zip` during release builds and is not committed to git.

## Local Release Build

Keep the prepared backend folders in place:

- `backend/vcclient-beatrice/dist/main/main.exe`
- `backend/voice-mode/manifest.json`

Then run:

```powershell
npm run dist:win
```

The script creates `build/backend-payload.zip`, bundles it into the installer, and writes the release files under `release/`.

## GitHub Actions Release Build

GitHub Actions builds from a clean checkout, so it cannot see the local ignored backend folders. The repository tracks `build/backend-payload.zip` through Git LFS so tagged release builds can fetch the backend payload automatically.

When the backend engine changes, rebuild the local release once, commit the updated `build/backend-payload.zip` LFS pointer, then push the new app version tag.

As a fallback, you can upload a prebuilt `backend-payload.zip` to a downloadable location and set this repository secret:

- `MORPHLY_BACKEND_PAYLOAD_URL`: direct URL for the zip payload.

If the URL needs an Authorization header, also set:

- `MORPHLY_BACKEND_PAYLOAD_AUTH_HEADER`: full header value, for example `Bearer <token>`.

The tagged release workflow downloads that payload, bundles it into the installer, and uploads:

- `release/Morphly-Voice-Console-Setup-<version>.exe`
- `release/Morphly-Voice-Console-Setup-<version>.exe.blockmap`
- `release/latest.yml`

## Notes

Use a fresh version tag whenever release workflow code changes, because GitHub Actions runs the workflow from the tagged commit.
