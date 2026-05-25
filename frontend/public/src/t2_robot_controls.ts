import { g } from "./globals.ts";

type RobotStatus = {
    connected: boolean;
    playing: boolean;
    status: string;
    error?: string;
};

const state = {
    root: null as HTMLDivElement | null,
    connectButton: null as HTMLButtonElement | null,
    disconnectButton: null as HTMLButtonElement | null,
    playButton: null as HTMLButtonElement | null,
    fpsSlider: null as HTMLInputElement | null,
    fpsInput: null as HTMLInputElement | null,
    fpsValue: null as HTMLSpanElement | null,
    statusDot: null as HTMLSpanElement | null,
    statusText: null as HTMLSpanElement | null,
};

async function requestRobot(path: "connect" | "disconnect" | "play", body?: object): Promise<RobotStatus> {
    const res = await fetch(`${g.BACKEND_URL}/robot/t2/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.status || `T2 robot ${path} failed`);
    return data;
}

function currentCsv(): string | null {
    const anim = (g.MODEL3D as any)?.anim;
    return typeof anim?.csvContent === "string" && anim.csvContent.trim() ? anim.csvContent : null;
}

function currentFps(): number {
    const inputFps = Number(state.fpsInput?.value);
    if (Number.isFinite(inputFps) && inputFps >= 0) return inputFps;

    const sliderFps = Number(state.fpsSlider?.value);
    if (Number.isFinite(sliderFps) && sliderFps >= 0) return sliderFps;

    const fps = Number((g.MODEL3D as any)?.anim?.fps);
    return Number.isFinite(fps) && fps >= 0 ? fps : 30;
}

function applyFps(value: number) {
    const fps = Math.max(0, Math.min(120, Math.round(value)));
    if (state.fpsSlider && Number(state.fpsSlider.value) !== fps) {
        state.fpsSlider.value = String(fps);
    }
    if (state.fpsInput && Number(state.fpsInput.value) !== fps) {
        state.fpsInput.value = String(fps);
    }
    if (state.fpsValue) {
        state.fpsValue.textContent = String(fps);
    }
    const anim = (g.MODEL3D as any)?.anim;
    if (g.CURRENT_MODEL === "t2" && anim) {
        anim.fps = fps;
    }
}

function setBusy(busy: boolean) {
    for (const button of [state.connectButton, state.disconnectButton, state.playButton]) {
        if (button) button.disabled = busy;
    }
}

function renderStatus(status?: Partial<RobotStatus>) {
    if (!state.root || !state.statusDot || !state.statusText) return;

    const isT2 = g.CURRENT_MODEL === "t2";
    state.root.style.display = isT2 ? "flex" : "none";

    const connected = Boolean(status?.connected);
    const playing = Boolean(status?.playing);
    state.statusDot.className = `t2-robot-dot ${playing ? "playing" : connected ? "connected" : ""}`;

    const backendStatus = (status?.status || "").trim();
    const hasUsefulStatus = backendStatus && backendStatus !== "Disconnected.";
    let label = playing ? "Playing" : connected ? "Connected" : "Disconnected";
    if (hasUsefulStatus) {
        label = backendStatus.replace(/^disconnected:\s*/i, "").replace(/^connected:\s*/i, "");
    }

    if (status?.error) {
        label = status.error;
    }

    const detailedLabel = label;
    if (/timed out waiting for subscribers/i.test(label)) {
        label = "Start ROS server";
    } else if (/ros 2 python packages are not available|no module named ['\"]?rclpy/i.test(label)) {
        label = "Source ROS workspace";
    } else if (/\[READY\].*streaming viewer frames/i.test(label)) {
        label = "Ready to publish motion";
    } else if (/stream did not become ready|stream failed before ready/i.test(label)) {
        label = "Check ROS server";
    }

    state.statusText.textContent = label;
    state.statusText.title = detailedLabel;

    applyFps(currentFps());
}

async function refreshStatus() {
    if (!state.root || g.CURRENT_MODEL !== "t2") {
        renderStatus();
        return;
    }

    try {
        const res = await fetch(`${g.BACKEND_URL}/robot/t2/status`);
        if (res.ok) renderStatus(await res.json());
    } catch {
        renderStatus({ connected: false, playing: false, error: "ROS unavailable" });
    }
}

export function initT2RobotControls() {
    const controlsRow = document.getElementById("controls-row");
    if (!controlsRow) return;

    const root = document.createElement("div");
    root.id = "t2-robot-controls";
    root.innerHTML = /*html*/ `
        <div class="t2-robot-actions">
            <span class="t2-robot-status" title="T2 ROS status">
                <span class="t2-robot-dot"></span>
                <span class="t2-robot-status-text">Disconnected</span>
            </span>
            <button class="t2-robot-button" data-action="connect" title="Connect T2 ROS">
                <span class="material-symbols-outlined">link</span>
            </button>
            <button class="t2-robot-button" data-action="disconnect" title="Disconnect T2 ROS">
                <span class="material-symbols-outlined">link_off</span>
            </button>
            <button class="t2-robot-button" data-action="play" title="Play loaded T2 motion through ROS">
                <span class="material-symbols-outlined">play_arrow</span>
            </button>
        </div>
        <label class="t2-robot-fps" title="T2 playback FPS">
            <span>FPS</span>
            <input class="t2-robot-fps-slider" type="range" min="0" max="120" step="1" value="30" data-action="fps-slider">
            <input class="t2-robot-fps-input" type="number" min="0" max="120" step="1" value="30" data-action="fps-input" aria-label="T2 FPS">
        </label>
    `;
    controlsRow.appendChild(root);

    state.root = root;
    state.connectButton = root.querySelector('[data-action="connect"]');
    state.disconnectButton = root.querySelector('[data-action="disconnect"]');
    state.playButton = root.querySelector('[data-action="play"]');
    state.fpsSlider = root.querySelector('[data-action="fps-slider"]');
    state.fpsInput = root.querySelector('[data-action="fps-input"]');
    state.fpsValue = root.querySelector(".t2-robot-fps-value");
    state.statusDot = root.querySelector(".t2-robot-dot");
    state.statusText = root.querySelector(".t2-robot-status-text");

    state.fpsSlider?.addEventListener("input", () => {
        applyFps(Number(state.fpsSlider?.value));
    });

    state.fpsInput?.addEventListener("input", () => {
        applyFps(Number(state.fpsInput?.value));
    });

    state.connectButton?.addEventListener("click", async () => {
        setBusy(true);
        try {
            renderStatus(await requestRobot("connect"));
        } catch (error) {
            renderStatus({ connected: false, playing: false, error: String((error as Error).message) });
        } finally {
            setBusy(false);
        }
    });

    state.disconnectButton?.addEventListener("click", async () => {
        setBusy(true);
        try {
            renderStatus(await requestRobot("disconnect"));
        } catch (error) {
            renderStatus({ connected: false, playing: false, error: String((error as Error).message) });
        } finally {
            setBusy(false);
        }
    });

    state.playButton?.addEventListener("click", async () => {
        const csv = currentCsv();
        if (!csv) {
            renderStatus({ connected: false, playing: false, error: "Load a T2 CSV first" });
            return;
        }

        setBusy(true);
        try {
            renderStatus(await requestRobot("play", { csv, fps: currentFps() }));
        } catch (error) {
            renderStatus({ connected: false, playing: false, error: String((error as Error).message) });
        } finally {
            setBusy(false);
        }
    });

    renderStatus();
    refreshStatus();
    window.setInterval(refreshStatus, 1500);
}
