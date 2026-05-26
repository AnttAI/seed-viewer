from __future__ import annotations

import json
import threading
import time
import urllib.parse
import csv
from io import StringIO
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from kimodo_generated import MEMORIES_ROOT, _kimodo_json, _slugify_prompt


TASK_INDEX_PATH = MEMORIES_ROOT / "seed_viewer_task_index.json"

router = APIRouter()
jobs: dict[str, dict[str, Any]] = {}
jobs_lock = threading.Lock()


class TaskGenerateRequest(BaseModel):
    prompts: list[str] = Field(..., min_length=1)
    name: str | None = None
    duration_seconds: float | None = Field(default=None, gt=0)
    seed: int = 42
    diffusion_steps: int = 100


class SequenceRequest(BaseModel):
    sequence: list[str]


def _memory_bvh_path(stem: str) -> Path:
    return MEMORIES_ROOT / "bvh" / Path(stem).with_suffix(".bvh")


def _memory_csv_path(stem: str) -> Path:
    return MEMORIES_ROOT / "t2_csv" / Path(stem).with_suffix(".csv")


def _read_index() -> dict[str, dict[str, Any]]:
    if not TASK_INDEX_PATH.is_file():
        return {}
    try:
        data = json.loads(TASK_INDEX_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _write_index(index: dict[str, dict[str, Any]]) -> None:
    TASK_INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    TASK_INDEX_PATH.write_text(json.dumps(index, indent=2, sort_keys=True), encoding="utf-8")


def _set_job(job_id: str, **updates: Any) -> None:
    with jobs_lock:
        current = dict(jobs.get(job_id) or {})
        current.update(updates)
        current["job_id"] = job_id
        current["updated_at"] = time.time()
        jobs[job_id] = current


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


def _split_lengths(total: int, parts: int) -> list[int]:
    boundaries = [round(index * total / parts) for index in range(parts + 1)]
    return [max(0, boundaries[index + 1] - boundaries[index]) for index in range(parts)]


def _split_csv_text(csv_text: str, parts: int) -> list[str]:
    rows = list(csv.reader(StringIO(csv_text)))
    if not rows:
        return []
    header, data_rows = rows[0], rows[1:]
    chunks = []
    start = 0
    for length in _split_lengths(len(data_rows), parts):
        output = StringIO()
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(header)
        for local_frame, row in enumerate(data_rows[start:start + length]):
            row = list(row)
            if row and header and header[0] == "Frame":
                row[0] = str(local_frame)
            writer.writerow(row)
        chunks.append(output.getvalue())
        start += length
    return chunks


def _split_bvh_text(bvh_text: str, parts: int) -> list[str]:
    lines = bvh_text.splitlines()
    try:
        motion_index = next(index for index, line in enumerate(lines) if line.strip() == "MOTION")
    except StopIteration:
        return []
    if motion_index + 2 >= len(lines):
        return []

    header_lines = lines[:motion_index + 1]
    frame_time_line = lines[motion_index + 2]
    frame_rows = lines[motion_index + 3:]
    chunks = []
    start = 0
    for length in _split_lengths(len(frame_rows), parts):
        chunk_rows = frame_rows[start:start + length]
        chunks.append("\n".join([
            *header_lines,
            f"Frames: {len(chunk_rows)}",
            frame_time_line,
            *chunk_rows,
        ]) + "\n")
        start += length
    return chunks


def _save_task_segments(task_id: str, prompts: list[str], files: dict[str, Any]) -> list[dict[str, Any]]:
    csv_chunks = _split_csv_text(files["csv"], len(prompts)) if isinstance(files.get("csv"), str) and files.get("csv") else []
    bvh_chunks = _split_bvh_text(files["bvh"], len(prompts)) if isinstance(files.get("bvh"), str) and files.get("bvh") else []

    items = []
    for index, prompt in enumerate(prompts):
        segment_stem = f"tasks/{task_id}/{index + 1:02d}_{_slugify_prompt(prompt)}"
        bvh_path = _memory_bvh_path(segment_stem)
        csv_path = _memory_csv_path(segment_stem)

        if index < len(bvh_chunks):
            bvh_path.parent.mkdir(parents=True, exist_ok=True)
            bvh_path.write_text(bvh_chunks[index], encoding="utf-8")
        if index < len(csv_chunks):
            csv_path.parent.mkdir(parents=True, exist_ok=True)
            csv_path.write_text(csv_chunks[index], encoding="utf-8")

        items.append(
            {
                "stem": segment_stem,
                "name": Path(segment_stem).name,
                "prompt": prompt,
                "order": index + 1,
                "bvh_path": str(bvh_path) if bvh_path.is_file() else None,
                "csv_path": str(csv_path) if csv_path.is_file() else None,
            }
        )
    return items


def _update_task(task_id: str, **updates: Any) -> dict[str, Any]:
    index = _read_index()
    task = dict(index.get(task_id) or {})
    task.update(updates)
    task["task_id"] = task_id
    task["updated_at"] = time.time()
    index[task_id] = task
    _write_index(index)
    return task


def _run_task(job_id: str, task_id: str, request: TaskGenerateRequest, task_name: str) -> None:
    prompts = [prompt.strip() for prompt in request.prompts if prompt.strip()]
    try:
        stem = f"tasks/{task_id}/continuous_{_slugify_prompt(task_name)}"
        _set_job(job_id, status="running", task_id=task_id, current_index=0, total=1)
        _update_task(
            task_id,
            name=task_name,
            prompts=prompts,
            items=[],
            sequence=[],
            status="running",
            created_at=time.time(),
            generation_mode="continuous_multi_prompt",
        )

        _set_job(job_id, status="generating", current_index=1, current_prompt="continuous task")
        payload: dict[str, Any] = {
            "prompt": prompts[0],
            "prompts": prompts,
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
        while True:
            time.sleep(1.0)
            query = urllib.parse.urlencode({"job_id": kimodo_job_id})
            job_response = _kimodo_json("GET", f"/job?{query}")
            kimodo_job = dict(job_response.get("job") or {})
            status = str(kimodo_job.get("status") or "running")
            _set_job(job_id, status=status, kimodo_job_id=kimodo_job_id, kimodo_job=kimodo_job)
            if status == "done":
                files_query = urllib.parse.urlencode({"job_id": kimodo_job_id})
                files = _kimodo_json("GET", f"/motion-files?{files_query}")
                if not files.get("ok"):
                    raise RuntimeError(str(files.get("error") or files))
                local_paths = _save_downloaded_motion(stem, files)
                items = _save_task_segments(task_id, prompts, files)
                for item in items:
                    item["source_continuous_stem"] = stem
                    item["source_bvh_path"] = local_paths.get("bvh_path")
                    item["source_csv_path"] = local_paths.get("csv_path")
                    item["remote_bvh_path"] = files.get("bvh_path")
                    item["remote_csv_path"] = files.get("csv_path")
                _set_job(job_id, status="done", task_id=task_id, items=items)
                _update_task(task_id, status="done", items=items, sequence=[item["stem"] for item in items])
                return
            if status == "error":
                raise RuntimeError(str(kimodo_job.get("error") or "Kimodo generation failed"))
    except Exception as exc:
        _set_job(job_id, status="error", error=str(exc), task_id=task_id)
        _update_task(task_id, status="error", error=str(exc))


@router.post("/generate")
def generate(request: TaskGenerateRequest):
    prompts = [prompt.strip() for prompt in request.prompts if prompt.strip()]
    if not prompts:
        return JSONResponse(status_code=400, content={"ok": False, "error": "Add at least one prompt."})

    base_name = request.name.strip() if request.name else "task_" + "_then_".join(_slugify_prompt(p) for p in prompts[:3])
    task_slug = _slugify_prompt(base_name)[:48] or "task"
    task_id = f"{task_slug}_{int(time.time())}"
    job_id = f"seed_task_{int(time.time() * 1000)}"
    _set_job(job_id, status="queued", task_id=task_id, prompts=prompts)
    threading.Thread(target=_run_task, args=(job_id, task_id, request, base_name), daemon=True).start()
    return {"ok": True, "job_id": job_id, "task_id": task_id}


@router.get("/job/{job_id}")
def job(job_id: str):
    with jobs_lock:
        current = dict(jobs.get(job_id) or {})
    if not current:
        return JSONResponse(status_code=404, content={"ok": False, "error": f"Unknown job_id: {job_id}"})
    return {"ok": True, "job": current}


@router.get("/tasks")
def tasks():
    index = _read_index()
    ordered = sorted(index.values(), key=lambda item: float(item.get("created_at") or 0), reverse=True)
    return {"ok": True, "tasks": ordered}


@router.get("/task/{task_id}")
def task(task_id: str):
    current = _read_index().get(task_id)
    if not current:
        return JSONResponse(status_code=404, content={"ok": False, "error": f"Unknown task: {task_id}"})
    return {"ok": True, "task": current}


@router.post("/task/{task_id}/sequence")
def sequence(task_id: str, request: SequenceRequest):
    index = _read_index()
    current = index.get(task_id)
    if not current:
        return JSONResponse(status_code=404, content={"ok": False, "error": f"Unknown task: {task_id}"})
    known = {item["stem"] for item in current.get("items", [])}
    sequence = [stem for stem in request.sequence if stem in known]
    if len(sequence) != len(known):
        sequence.extend(stem for stem in known if stem not in sequence)
    current["sequence"] = sequence
    current["updated_at"] = time.time()
    index[task_id] = current
    _write_index(index)
    return {"ok": True, "task": current}


@router.get("/motion/{stem:path}")
def motion(stem: str):
    bvh_path = _memory_bvh_path(stem)
    csv_path = _memory_csv_path(stem)
    if not bvh_path.is_file() and not csv_path.is_file():
        return JSONResponse(status_code=404, content={"ok": False, "error": f"Task motion not found: {stem}"})
    return {
        "ok": True,
        "stem": stem,
        "name": Path(stem).name,
        "bvh": bvh_path.read_text(encoding="utf-8") if bvh_path.is_file() else None,
        "csv": csv_path.read_text(encoding="utf-8") if csv_path.is_file() else None,
    }
