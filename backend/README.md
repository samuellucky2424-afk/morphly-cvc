# Morphly Backend Bundle

Electron bundles this folder as an unpacked `extraResources` directory and runs `start_http.bat` silently at app launch.

Place a prepared w-okada voice engine here before packaging. Supported layouts:

- `backend/start_http.local.bat` for your own launch command.
- `backend/voice-changer/start_http.bat` from a prepared upstream checkout or release.
- `backend/voice-changer/server/MMVCServerSIO.py` for a Python checkout.
- `backend/voice-changer.exe` for a compiled backend.

The engine must expose `http://127.0.0.1:18000/api/hello` by default. Electron passes
`MORPHLY_ENGINE_HOST` and `MORPHLY_ENGINE_PORT` to `start_http.bat` when launching the backend.

`native-client-headless-stub.exe` is copied over VCClient's native-client launcher at runtime so the
HTTP engine stays alive without opening the vendor VCClient UI.

## RVC voice-mode models

Custom RVC `.pth` voices can live under `backend/voice-mode`. Run this after adding or renaming files:

```bat
.\.venv\Scripts\python.exe sync_voice_mode_models.py
```

The script writes `voice-mode/manifest.json` and managed RVC slot metadata under
`voice-changer/server/model_dir/10` through `13`.

When `voice-mode/manifest.json` exists, `start_http.bat` prefers `start_http.local.bat`, which launches
the legacy Python RVC backend. If you package the app and still want these RVC voices available in the
installer, the Python backend and its virtual environment must be included as resources too; otherwise
the bundled Beatrice-only engine will not run `.pth` RVC models.
