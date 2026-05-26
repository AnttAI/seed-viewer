from __future__ import annotations

import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field


KIMODO_CONTROL_URL = os.environ.get("KIMODO_CONTROL_URL", "http://192.168.31.178:8787")
MEMORIES_ROOT = Path("/home/jony/Downloads/soma-retargeter/assets/motions")
INDEX_PATH = MEMORIES_ROOT / "seed_viewer_generated_index.json"

router = APIRouter()
jobs: dict[str, dict[str, Any]] = {}
jobs_lock = threading.Lock()


class GenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    duration_seconds: float | None = Field(default=None, gt=0)
    seed: int = 42
    diffusion_steps: int = 100


def _slugify_prompt(prompt: str) -> str:
    words = re.findall(r"[a-z0-9]+", prompt.lower())
    slug = "_".join(words[:10])[:64].strip("_")
    return slug or "generated_motion"


def _memory_bvh_path(stem: str) -> Path:
    return MEMORIES_ROOT / "bvh" / Path(stem).with_suffix(".bvh")


def _memory_csv_path(stem: str) -> Path:
    return MEMORIES_ROOT / "t2_csv" / Path(stem).with_suffix(".csv")


def _next_prompt_stem(prompt: str) -> str:
    base = f"generated/{_slugify_prompt(prompt)}"
    stem = base
    suffix = 2
    while _memory_bvh_path(stem).exists() or _memory_csv_path(stem).exists():
        stem = f"{base}_{suffix:02d}"
        suffix += 1
    return stem


def _read_index() -> dict[str, dict[str, Any]]:
    if not INDEX_PATH.is_file():
        return {}
    try:
        data = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _write_index(index: dict[str, dict[str, Any]]) -> None:
    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    INDEX_PATH.write_text(json.dumps(index, indent=2, sort_keys=True), encoding="utf-8")


def _remember_generated(stem: str, prompt: str, job: dict[str, Any]) -> None:
    index = _read_index()
    index[stem] = {
        "stem": stem,
        "prompt": prompt,
        "bvh_path": job.get("bvh_path"),
        "csv_path": job.get("csv_path"),
        "created_at": time.time(),
    }
    _write_index(index)


def _save_downloaded_motion(stem: str, files: dict[str, Any]) -> dict[str, Any]:
    bvh_text = files.get("bvh")
    csv_text = files.get("csv")
    bvh_path = _memory_bvh_path(stem)
    csv_path = _memory_csv_path(stem)

    if isinstance(bvh_text, str) and bvh_text:
        bvh_path.parent.mkdir(parents=True, exist_ok=True)
        bvh_path.write_text(bvh_text, encoding="utf-8")
    if isinstance(csv_text, str) and csv_text:
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        csv_path.write_text(csv_text, encoding="utf-8")

    return {
        "bvh_path": str(bvh_path) if bvh_path.is_file() else None,
        "csv_path": str(csv_path) if csv_path.is_file() else None,
    }


def _kimodo_json(method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        f"{KIMODO_CONTROL_URL}{path}",
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise RuntimeError(
            "Kimodo control server is not reachable. Start it with: "
            "TEXT_ENCODER_MODE=local TEXT_ENCODER_DEVICE=cpu python -m kimodo.demo.robot_app "
            "--model kimodo-soma-rp --control-host 0.0.0.0 --control-port 8787"
        ) from exc


def _set_job(job_id: str, **updates: Any) -> None:
    with jobs_lock:
        current = dict(jobs.get(job_id) or {})
        current.update(updates)
        current["job_id"] = job_id
        current["updated_at"] = time.time()
        jobs[job_id] = current


def _run_generate(job_id: str, request: GenerateRequest, stem: str) -> None:
    try:
        _set_job(job_id, status="queued", stem=stem, prompt=request.prompt)
        payload: dict[str, Any] = {
            "prompt": request.prompt,
            "stem": stem,
            "seed": request.seed,
            "diffusion_steps": request.diffusion_steps,
        }
        if request.duration_seconds is not None:
            payload["duration_seconds"] = request.duration_seconds

        response = _kimodo_json("POST", "/generate-retarget", payload)
        if not response.get("ok"):
            raise RuntimeError(str(response.get("error") or response))

        kimodo_job_id = str(response["job_id"])
        _set_job(job_id, status="running", kimodo_job_id=kimodo_job_id)

        while True:
            time.sleep(1.0)
            query = urllib.parse.urlencode({"job_id": kimodo_job_id})
            job_response = _kimodo_json("GET", f"/job?{query}")
            kimodo_job = dict(job_response.get("job") or {})
            status = str(kimodo_job.get("status") or "running")
            _set_job(job_id, status=status, kimodo_job=kimodo_job)
            if status == "done":
                files_query = urllib.parse.urlencode({"job_id": kimodo_job_id})
                files = _kimodo_json("GET", f"/motion-files?{files_query}")
                if not files.get("ok"):
                    raise RuntimeError(str(files.get("error") or files))
                local_paths = _save_downloaded_motion(stem, files)
                kimodo_job.update(local_paths)
                _remember_generated(stem, request.prompt, kimodo_job)
                _set_job(
                    job_id,
                    status="done",
                    bvh_path=local_paths.get("bvh_path"),
                    csv_path=local_paths.get("csv_path"),
                    remote_bvh_path=files.get("bvh_path"),
                    remote_csv_path=files.get("csv_path"),
                    stem=kimodo_job.get("stem") or stem,
                )
                return
            if status == "error":
                raise RuntimeError(str(kimodo_job.get("error") or "Kimodo generation failed"))
    except Exception as exc:
        _set_job(job_id, status="error", error=str(exc))


def _generated_items() -> list[dict[str, Any]]:
    index = _read_index()
    stems = set(index.keys())
    generated_bvh = MEMORIES_ROOT / "bvh" / "generated"
    generated_csv = MEMORIES_ROOT / "t2_csv" / "generated"
    if generated_bvh.is_dir():
        stems.update(str(path.relative_to(MEMORIES_ROOT / "bvh").with_suffix("")) for path in generated_bvh.rglob("*.bvh"))
    if generated_csv.is_dir():
        stems.update(str(path.relative_to(MEMORIES_ROOT / "t2_csv").with_suffix("")) for path in generated_csv.rglob("*.csv"))

    items = []
    for stem in sorted(stems):
        bvh_path = _memory_bvh_path(stem)
        csv_path = _memory_csv_path(stem)
        meta = index.get(stem, {})
        items.append(
            {
                "stem": stem,
                "name": Path(stem).name,
                "prompt": meta.get("prompt") or Path(stem).name.replace("_", " "),
                "has_bvh": bvh_path.is_file(),
                "has_t2_csv": csv_path.is_file(),
                "bvh_path": str(bvh_path) if bvh_path.is_file() else None,
                "csv_path": str(csv_path) if csv_path.is_file() else None,
                "created_at": meta.get("created_at"),
            }
        )
    return list(reversed(items))


@router.post("/generate")
def generate(request: GenerateRequest):
    stem = _next_prompt_stem(request.prompt)
    job_id = f"seed_gen_{int(time.time() * 1000)}"
    _set_job(job_id, status="queued", stem=stem, prompt=request.prompt)
    threading.Thread(target=_run_generate, args=(job_id, request, stem), daemon=True).start()
    return {"ok": True, "job_id": job_id, "stem": stem}


@router.get("/job/{job_id}")
def job(job_id: str):
    with jobs_lock:
        current = dict(jobs.get(job_id) or {})
    if not current:
        return JSONResponse(status_code=404, content={"ok": False, "error": f"Unknown job_id: {job_id}"})
    return {"ok": True, "job": current}


@router.get("/motions")
def motions():
    return {"ok": True, "motions": _generated_items()}


@router.get("/motion/{stem:path}")
def motion(stem: str):
    bvh_path = _memory_bvh_path(stem)
    csv_path = _memory_csv_path(stem)
    if not bvh_path.is_file() and not csv_path.is_file():
        return JSONResponse(status_code=404, content={"ok": False, "error": f"Generated motion not found: {stem}"})
    return {
        "ok": True,
        "stem": stem,
        "name": Path(stem).name,
        "bvh": bvh_path.read_text(encoding="utf-8") if bvh_path.is_file() else None,
        "csv": csv_path.read_text(encoding="utf-8") if csv_path.is_file() else None,
    }
