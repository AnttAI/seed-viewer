from __future__ import annotations

import csv
import json
import math
import os
import subprocess
import threading
import time
from dataclasses import dataclass, field
from io import StringIO
from pathlib import Path
from typing import Callable

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field


ROBOT_JOINT_NAMES = [f"joint{i}" for i in range(1, 8)]
RIGHT_T2_COLUMNS = [f"right_joint{i}_dof" for i in range(1, 8)]
LEFT_T2_COLUMNS = [f"left_joint{i}_dof" for i in range(1, 8)]

StatusCallback = Callable[[str, str], None]


def default_stream_script() -> Path:
    return Path(__file__).resolve().parents[1] / "scripts" / "stream_t2_robot_sync.sh"


@dataclass(frozen=True)
class ArmFrame:
    frame_index: int
    right: list[float]
    left: list[float]


@dataclass
class T2RosConnection:
    stream_script: Path = field(default_factory=default_stream_script)
    process: subprocess.Popen[str] | None = None
    last_output: list[str] = field(default_factory=list)
    _lock: threading.Lock = field(default_factory=threading.Lock)
    _ready: threading.Event = field(default_factory=threading.Event)

    def is_connected(self) -> bool:
        with self._lock:
            return self.process is not None and self.process.poll() is None and self._ready.is_set()

    def connect(self, on_status: StatusCallback | None = None, wait_timeout: float = 7.0) -> None:
        with self._lock:
            if self.process is not None and self.process.poll() is None:
                if self._ready.is_set():
                    return
                process = self.process
            else:
                script = self.stream_script.expanduser().resolve()
                if not script.is_file():
                    raise FileNotFoundError(f"T2 robot stream script not found: {script}")

                process = subprocess.Popen(
                    ["bash", str(script)],
                    cwd=str(script.parent.parent),
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                    env=os.environ.copy(),
                )
                self.process = process
                self.last_output.clear()
                self._ready.clear()
                self._watch_process(process, on_status)

        if not self._ready.wait(timeout=wait_timeout):
            if process.poll() is None:
                self.disconnect()
                tail = "\n".join(self.last_output[-6:]) or "Timed out waiting for ROS stream readiness."
                raise TimeoutError(f"T2 ROS stream did not become ready.\n{tail}")
            tail = "\n".join(self.last_output[-6:]) or f"Exit code {process.returncode}"
            raise RuntimeError(f"T2 ROS stream failed before ready.\n{tail}")

    def _watch_process(self, process: subprocess.Popen[str], on_status: StatusCallback | None) -> None:
        def _watch() -> None:
            if process.stdout is not None:
                for line in process.stdout:
                    clean = line.rstrip()
                    self.last_output.append(clean)
                    self.last_output[:] = self.last_output[-20:]
                    print(f"[T2 ROS] {clean}", flush=True)
                    if clean.startswith("[READY]"):
                        self._ready.set()
                        if on_status is not None:
                            on_status("connected", clean)

            return_code = process.wait()
            with self._lock:
                if self.process is process:
                    self.process = None
                    self._ready.clear()
            if on_status is not None:
                tail = "\n".join(self.last_output[-6:]) or f"Exit code {return_code}"
                on_status("disconnected", tail)

        threading.Thread(target=_watch, daemon=True).start()

    def start(self, on_status: StatusCallback | None = None) -> None:
        with self._lock:
            if self.process is not None and self.process.poll() is None:
                return

            script = self.stream_script.expanduser().resolve()
            if not script.is_file():
                raise FileNotFoundError(f"T2 robot stream script not found: {script}")

            process = subprocess.Popen(
                ["bash", str(script)],
                cwd=str(script.parent.parent),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                env=os.environ.copy(),
            )
            self.process = process
            self.last_output.clear()
            self._ready.clear()
            self._watch_process(process, on_status)

    def disconnect(self) -> None:
        with self._lock:
            process = self.process
            self.process = None
            self._ready.clear()
        if process is None or process.poll() is not None:
            print("[T2 ROS] Disconnect requested: no active stream process.", flush=True)
            return

        print(f"[T2 ROS] Disconnect requested: stopping stream process pid={process.pid}.", flush=True)
        if process.stdin is not None:
            try:
                process.stdin.close()
            except OSError:
                pass
        process.terminate()
        try:
            process.wait(timeout=2.0)
            print(f"[T2 ROS] Stream process stopped with exit code {process.returncode}.", flush=True)
        except subprocess.TimeoutExpired:
            print("[T2 ROS] Stream process did not stop after terminate; killing it.", flush=True)
            process.kill()
            process.wait(timeout=2.0)
            print(f"[T2 ROS] Stream process killed with exit code {process.returncode}.", flush=True)

    def send_frame(self, frame: ArmFrame) -> None:
        with self._lock:
            process = self.process
        if process is None or process.poll() is not None or process.stdin is None:
            raise RuntimeError("T2 ROS stream is not connected.")

        payload = json.dumps(
            {
                "frame_index": frame.frame_index,
                "right": frame.right,
                "left": frame.left,
            },
            separators=(",", ":"),
        )
        try:
            process.stdin.write(payload + "\n")
            process.stdin.flush()
        except (BrokenPipeError, OSError) as exc:
            self.disconnect()
            raise RuntimeError("T2 ROS stream disconnected while sending a frame.") from exc


class ConnectRequest(BaseModel):
    pass


class PlayRequest(BaseModel):
    csv: str = Field(..., min_length=1)
    fps: float = Field(default=30.0, ge=0)
    playback_speed: float = Field(default=1.0, gt=0)


router = APIRouter()
connection = T2RosConnection()
play_lock = threading.Lock()
play_stop = threading.Event()
play_thread: threading.Thread | None = None
playing = False
last_status = "Disconnected."


def parse_arm_frames(csv_content: str) -> list[ArmFrame]:
    filtered = "\n".join(
        line for line in csv_content.splitlines() if line.strip() and not line.lstrip().startswith("#")
    )
    reader = csv.DictReader(StringIO(filtered))
    if reader.fieldnames is None:
        raise ValueError("CSV has no header.")

    missing = [column for column in [*RIGHT_T2_COLUMNS, *LEFT_T2_COLUMNS] if column not in reader.fieldnames]
    if missing:
        raise ValueError("CSV is not a T2 arm CSV. Missing columns: " + ", ".join(missing))

    frames: list[ArmFrame] = []
    for source_index, row in enumerate(reader):
        try:
            frame_index = int(float(row.get("Frame", source_index)))
            right = [math.radians(float(row[column])) for column in RIGHT_T2_COLUMNS]
            left = [math.radians(float(row[column])) for column in LEFT_T2_COLUMNS]
        except ValueError as exc:
            raise ValueError(f"Invalid numeric data near CSV row {source_index + 2}.") from exc
        frames.append(ArmFrame(frame_index=frame_index, right=right, left=left))

    if not frames:
        raise ValueError("CSV has no playable T2 frames.")
    return frames


def _set_status(value: str) -> None:
    global last_status
    last_status = value


def _status_payload() -> dict[str, object]:
    return {
        "connected": connection.is_connected(),
        "playing": playing,
        "status": last_status,
        "last_output": connection.last_output[-6:],
    }


def _stop_playback() -> None:
    global play_thread, playing
    play_stop.set()
    thread = play_thread
    if thread is not None and thread.is_alive() and thread is not threading.current_thread():
        thread.join(timeout=1.0)
    play_thread = None
    playing = False
    play_stop.clear()


@router.get("/status")
def status():
    return _status_payload()


@router.post("/connect")
def connect(_request: ConnectRequest | None = None):
    try:
        connection.connect(on_status=lambda title, body: _set_status(f"{title}: {body}"))
        _set_status("Connected to T2 ROS stream.")
        return _status_payload()
    except Exception as exc:
        _set_status(f"Connection failed: {exc}")
        return JSONResponse(status_code=500, content={**_status_payload(), "error": str(exc)})


@router.post("/disconnect")
def disconnect():
    _stop_playback()
    connection.disconnect()
    _set_status("Disconnected.")
    return _status_payload()


@router.post("/play")
def play(request: PlayRequest):
    global play_thread, playing

    try:
        frames = parse_arm_frames(request.csv)
    except Exception as exc:
        _set_status(f"CSV failed: {exc}")
        return JSONResponse(status_code=400, content={**_status_payload(), "error": str(exc)})

    try:
        connection.connect(on_status=lambda title, body: _set_status(f"{title}: {body}"))
    except Exception as exc:
        _set_status(f"Connection failed: {exc}")
        return JSONResponse(status_code=500, content={**_status_payload(), "error": str(exc)})

    with play_lock:
        _stop_playback()
        play_stop.clear()
        playing = True
        effective_fps = request.fps if request.fps > 0 else 30.0
        interval = 1.0 / (effective_fps * request.playback_speed)

        def _run() -> None:
            global playing
            try:
                for frame in frames:
                    if play_stop.is_set():
                        break
                    connection.send_frame(frame)
                    time.sleep(interval)
                _set_status(f"Played {len(frames)} T2 frames.")
            except Exception as exc:
                connection.disconnect()
                _set_status(f"Playback stopped: {exc}")
            finally:
                playing = False
                play_stop.clear()

        play_thread = threading.Thread(target=_run, daemon=True)
        play_thread.start()
        _set_status(f"Playing {len(frames)} T2 frames through ROS.")

    return _status_payload()
