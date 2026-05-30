from __future__ import annotations

import argparse
import json
import shutil
import sys
import warnings
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from urllib import error, request


BACKEND_DIR = Path(__file__).resolve().parent
VOICE_MODE_DIR = BACKEND_DIR / "voice-mode"
LEGACY_MODEL_DIR = BACKEND_DIR / "voice-changer" / "server" / "model_dir"
MANIFEST_PATH = VOICE_MODE_DIR / "manifest.json"
DEFAULT_ENGINE_URL = "http://127.0.0.1:18000"


@dataclass(frozen=True)
class VoiceSource:
    slot: int
    voice_id: str
    name: str
    group: str
    model_path: Path
    index_path: Path | None = None


@dataclass
class RvcInfo:
    modelType: str = "pyTorchRVCv2"
    samplingRate: int = 40000
    f0: bool = True
    embChannels: int = 768
    embOutputLayer: int = 12
    useFinalProj: bool = False
    embedder: str = "hubert_base"
    version: str = "v2"


VOICE_SOURCES = [
    VoiceSource(
        slot=10,
        voice_id="elon-musk",
        name="Elon Musk",
        group="male",
        model_path=VOICE_MODE_DIR / "male-voice" / "Elonmusk (1).pth",
        index_path=VOICE_MODE_DIR / "male-voice" / "added_IVF819_Flat_nprobe_1_Elonmusk_v2.index",
    ),
    VoiceSource(
        slot=11,
        voice_id="barack-obama",
        name="Barack Obama",
        group="male",
        model_path=VOICE_MODE_DIR / "male-voice" / "BarackObama_370e_24420s.pth",
        index_path=VOICE_MODE_DIR / "male-voice" / "added_IVF980_Flat_nprobe_1_v2.index",
    ),
    VoiceSource(
        slot=12,
        voice_id="future-2700-steps",
        name="Future - 2700 Steps",
        group="female",
        model_path=VOICE_MODE_DIR / "femal-voice" / "model.pth",
    ),
    VoiceSource(
        slot=13,
        voice_id="voice-nell-v2",
        name="Voice Nell V2",
        group="female",
        model_path=VOICE_MODE_DIR / "femal-voice" / "Voice_Nell_V2.pth",
    ),
]


def file_size(path: Path | None) -> int | None:
    return path.stat().st_size if path and path.exists() else None


def fallback_info_from_metadata(source: VoiceSource) -> RvcInfo:
    metadata_path = source.model_path.parent / "metadata.json"

    if metadata_path.exists() and source.model_path.name == "model.pth":
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            torch_metadata = metadata.get("torchMetadata", {})
            config = torch_metadata.get("extra_info", {}).get("config") or torch_metadata.get("config", {})
            version = torch_metadata.get("version") or metadata.get("type") or "v1"
            f0 = bool(torch_metadata.get("f0", 1))
            raw_sampling_rate = torch_metadata.get("extra_info", {}).get("sr", 40000)
            if isinstance(raw_sampling_rate, str) and raw_sampling_rate.lower().endswith("k"):
                sampling_rate = int(float(raw_sampling_rate[:-1]) * 1000)
            else:
                sampling_rate = int(raw_sampling_rate)

            if isinstance(config, list) and config:
                sampling_rate = int(config[-1])

            if version == "v1":
                return RvcInfo(
                    modelType="pyTorchRVC" if f0 else "pyTorchRVCNono",
                    samplingRate=sampling_rate,
                    f0=f0,
                    embChannels=256,
                    embOutputLayer=9,
                    useFinalProj=True,
                    version="v1",
                )
        except Exception as exc:
            print(f"metadata inspect failed for {source.model_path.name}: {exc}", file=sys.stderr)

    return RvcInfo()


def inspect_rvc_info(source: VoiceSource) -> RvcInfo:
    fallback = fallback_info_from_metadata(source)

    try:
        import torch  # type: ignore
    except Exception:
        return fallback

    try:
        try:
            with warnings.catch_warnings():
                warnings.filterwarnings("ignore", message="TypedStorage is deprecated.*")
                checkpoint = torch.load(source.model_path, map_location="cpu", weights_only=True)
        except TypeError:
            print(f"safe checkpoint inspection is unavailable for {source.model_path.name}; using fallback metadata.", file=sys.stderr)
            return fallback

        config = checkpoint.get("config")
        if not isinstance(config, list) or not config:
            return fallback

        version = checkpoint.get("version") or "v1"
        f0 = bool(checkpoint.get("f0", 1))
        sampling_rate = int(config[-1])
        config_len = len(config)

        if version == "voras_beta":
            embedder = str(checkpoint.get("embedder_name", "hubert_base"))
            if embedder.endswith("768"):
                embedder = embedder[:-3]

            return RvcInfo(
                modelType="pyTorchVoRASbeta",
                samplingRate=sampling_rate,
                f0=f0,
                embChannels=768,
                embOutputLayer=int(checkpoint.get("embedder_output_layer", 9)),
                useFinalProj=False,
                embedder=embedder,
                version="voras_beta",
            )

        if config_len == 18:
            if version == "v1":
                return RvcInfo(
                    modelType="pyTorchRVC" if f0 else "pyTorchRVCNono",
                    samplingRate=sampling_rate,
                    f0=f0,
                    embChannels=256,
                    embOutputLayer=9,
                    useFinalProj=True,
                    version="v1",
                )

            return RvcInfo(
                modelType="pyTorchRVCv2" if f0 else "pyTorchRVCv2Nono",
                samplingRate=sampling_rate,
                f0=f0,
                embChannels=768,
                embOutputLayer=12,
                useFinalProj=False,
                version="v2",
            )

        emb_channels = int(config[17]) if len(config) > 17 else fallback.embChannels
        emb_output_layer = int(checkpoint.get("embedder_output_layer", 9))
        embedder = str(checkpoint.get("embedder_name", "hubert_base"))
        if embedder.endswith("768"):
            embedder = embedder[:-3]

        return RvcInfo(
            modelType="pyTorchWebUI" if f0 else "pyTorchWebUINono",
            samplingRate=sampling_rate,
            f0=f0,
            embChannels=emb_channels,
            embOutputLayer=emb_output_layer,
            useFinalProj=emb_channels == 256,
            embedder=embedder,
            version=str(version),
        )
    except Exception as exc:
        print(f"checkpoint inspect failed for {source.model_path.name}: {exc}", file=sys.stderr)
        return fallback


def slot_params(source: VoiceSource, info: RvcInfo) -> dict[str, Any]:
    return {
        "slotIndex": -1,
        "voiceChangerType": "RVC",
        "name": source.name,
        "description": f"Imported from backend/voice-mode/{source.group}-voice",
        "credit": "",
        "termsOfUseUrl": "",
        "iconFile": "",
        "speakers": {"0": source.name},
        "modelFile": source.model_path.name,
        "indexFile": source.index_path.name if source.index_path else "",
        "defaultTune": 0,
        "defaultIndexRatio": 0,
        "defaultProtect": 0.5,
        "isONNX": False,
        "modelType": info.modelType,
        "samplingRate": info.samplingRate,
        "f0": info.f0,
        "embChannels": info.embChannels,
        "embOutputLayer": info.embOutputLayer,
        "useFinalProj": info.useFinalProj,
        "deprecated": False,
        "embedder": info.embedder,
        "sampleId": "",
        "version": info.version,
    }


def sync_legacy_slot(source: VoiceSource, params: dict[str, Any]) -> None:
    slot_dir = LEGACY_MODEL_DIR / str(source.slot)
    slot_dir.mkdir(parents=True, exist_ok=True)

    for old_file in slot_dir.iterdir():
        if old_file.is_file():
            old_file.unlink()
        elif old_file.is_dir():
            shutil.rmtree(old_file)

    shutil.copy2(source.model_path, slot_dir / source.model_path.name)

    if source.index_path:
        shutil.copy2(source.index_path, slot_dir / source.index_path.name)

    (slot_dir / "params.json").write_text(json.dumps(params, indent=4), encoding="utf-8")


def write_manifest(entries: list[dict[str, Any]], engine_note: str) -> None:
    VOICE_MODE_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schemaVersion": 1,
        "sourceDirectory": "backend/voice-mode",
        "managedSlots": [entry["slot"] for entry in entries],
        "engineNote": engine_note,
        "voices": entries,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def request_json(url: str, payload: dict[str, Any] | None = None, timeout: int = 8) -> Any:
    data = None
    headers = {}

    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = request.Request(url, data=data, headers=headers, method="POST" if payload is not None else "GET")
    with request.urlopen(req, timeout=timeout) as response:
        body = response.read().decode("utf-8")
        return json.loads(body) if body else None


def try_legacy_slot(engine_url: str, source: VoiceSource) -> str | None:
    try:
        info = request_json(f"{engine_url}/info")
    except Exception:
        return None

    for slot in info.get("modelSlots", []):
        if int(slot.get("slotIndex", -1)) == source.slot and slot.get("voiceChangerType") == "RVC":
            return "available: legacy RVC slot"

    return "skipped: legacy engine is running but this slot is not visible"


def try_live_import(engine_url: str, source: VoiceSource) -> str:
    try:
        props = request_json(f"{engine_url}/api/server-properties/properties")
    except (error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        legacy_status = try_legacy_slot(engine_url, source)
        return legacy_status or f"skipped: engine unavailable ({exc})"

    supported_types = props.get("available_voice_changer_types") or []
    if "RVC" not in supported_types:
        legacy_status = try_legacy_slot(engine_url, source)
        return legacy_status or "skipped: running engine does not advertise RVC support"

    payload = {
        "voice_changer_type": "RVC",
        "name": source.name,
        "slot_index": source.slot,
        "model_file": str(source.model_path),
        "index_file": str(source.index_path) if source.index_path else None,
        "embedder": "hubert_base_l9fp",
    }

    try:
        request_json(f"{engine_url}/api/slot-manager/slots", payload=payload, timeout=180)
        return "imported"
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        return f"failed: HTTP {exc.code} {detail}"
    except Exception as exc:
        return f"failed: {exc}"


def build_manifest_entry(source: VoiceSource, params: dict[str, Any], live_status: str) -> dict[str, Any]:
    return {
        "id": source.voice_id,
        "slot": source.slot,
        "name": source.name,
        "group": source.group,
        "format": "RVC",
        "voiceChangerType": "RVC",
        "speaker": 0,
        "modelFile": str(source.model_path.relative_to(BACKEND_DIR)).replace("\\", "/"),
        "modelFileSize": file_size(source.model_path),
        "indexFile": str(source.index_path.relative_to(BACKEND_DIR)).replace("\\", "/") if source.index_path else "",
        "indexFileSize": file_size(source.index_path),
        "legacySlotFile": str((LEGACY_MODEL_DIR / str(source.slot) / "params.json").relative_to(BACKEND_DIR)).replace("\\", "/"),
        "modelType": params["modelType"],
        "samplingRate": params["samplingRate"],
        "f0": params["f0"],
        "embedder": params["embedder"],
        "liveImportStatus": live_status,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync backend/voice-mode RVC models into managed slots.")
    parser.add_argument("--engine-url", default=DEFAULT_ENGINE_URL)
    parser.add_argument("--skip-live-import", action="store_true")
    args = parser.parse_args()

    missing = [str(source.model_path) for source in VOICE_SOURCES if not source.model_path.exists()]
    missing += [str(source.index_path) for source in VOICE_SOURCES if source.index_path and not source.index_path.exists()]

    if missing:
        print("Missing voice-mode files:", file=sys.stderr)
        for item in missing:
            print(f"  {item}", file=sys.stderr)
        return 1

    entries: list[dict[str, Any]] = []

    for source in VOICE_SOURCES:
        info = inspect_rvc_info(source)
        params = slot_params(source, info)
        sync_legacy_slot(source, params)
        live_status = "skipped: disabled by flag" if args.skip_live_import else try_live_import(args.engine_url.rstrip("/"), source)
        entries.append(build_manifest_entry(source, params, live_status))
        print(f"{source.name}: slot {source.slot}, {params['modelType']}, live import {live_status}")

    engine_note = (
        "These RVC .pth voices are synced into the legacy Python voice-changer slots. "
        "Morphly launches that RVC backend when backend/voice-mode/manifest.json exists."
    )
    write_manifest(entries, engine_note)
    print(f"Wrote {MANIFEST_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
