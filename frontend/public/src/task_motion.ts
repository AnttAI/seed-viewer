import { g } from "./globals.ts";
import { loadBVHString } from "./animation.ts";
import { loadG1CSVString } from "./g1_animation.ts";
import { isOk } from "./helpers.js";

type TaskItem = {
    stem: string;
    name: string;
    prompt: string;
};

type Task = {
    task_id: string;
    name: string;
    status: string;
    items: TaskItem[];
    sequence: string[];
};

let active = false;
let currentTask: Task | null = null;
let sequence: string[] = [];
let playingSequence = false;

function setActiveNav(nav: string) {
    document.querySelectorAll(".nav-btn").forEach((item) => {
        item.classList.toggle("nav-btn-active", item.getAttribute("data-nav") === nav);
    });
}

function escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[char] || char);
}

function setStatus(message: string) {
    const el = document.getElementById("task-status");
    if (el) el.textContent = message;
}

function promptRows(): HTMLInputElement[] {
    return Array.from(document.querySelectorAll(".task-prompt-input"));
}

function addPromptRow(value = "") {
    const container = document.getElementById("task-prompts");
    if (!container) return;
    const row = document.createElement("div");
    row.className = "task-prompt-row";
    row.innerHTML = /*html*/`
        <input spellcheck="false" class="task-prompt-input" type="text" placeholder="Prompt..." value="${escapeHtml(value)}">
        <button class="task-icon-button" title="Remove prompt"><span class="material-symbols-outlined">remove</span></button>
    `;
    row.querySelector("button")?.addEventListener("click", () => {
        if (promptRows().length > 1) row.remove();
    });
    container.appendChild(row);
}

async function loadTaskMotion(stem: string) {
    g.SPINNER.show("Loading task motion");
    try {
        const data = await fetch(`${g.BACKEND_URL}/kimodo/task/motion/${encodeURIComponent(stem)}`).then(isOk);
        if (g.CURRENT_MODEL === "t2") {
            if (!data.csv) throw new Error("Task motion has no T2 CSV.");
            await loadG1CSVString(data.csv, data.name, false, { Name: data.name, Stem: data.stem, Source: "TASK" });
        } else {
            if (!data.bvh) throw new Error("Task motion has no BVH.");
            await loadBVHString(data.bvh, data.name, false, { Name: data.name, Stem: data.stem, Source: "TASK" });
        }
    } finally {
        g.SPINNER.hide("Loading task motion");
    }
}

function orderedItems(): TaskItem[] {
    if (!currentTask) return [];
    const byStem = new Map(currentTask.items.map((item) => [item.stem, item]));
    return sequence.map((stem) => byStem.get(stem)).filter(Boolean) as TaskItem[];
}

async function saveSequence() {
    if (!currentTask) return;
    await fetch(`${g.BACKEND_URL}/kimodo/task/task/${currentTask.task_id}/sequence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sequence }),
    }).then(isOk);
}

function moveItem(stem: string, direction: -1 | 1) {
    const index = sequence.indexOf(stem);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= sequence.length) return;
    [sequence[index], sequence[target]] = [sequence[target], sequence[index]];
    renderSequence();
    saveSequence().catch((error) => setStatus((error as Error).message || String(error)));
}

function renderSequence() {
    const body = document.getElementById("task-sequence-body");
    if (!body) return;
    const items = orderedItems();
    if (!items.length) {
        body.innerHTML = /*html*/`
            <tr><td class="px-2 py-3 text-sm text-gray-400" colspan="4">No task motions yet.</td></tr>
        `;
        return;
    }

    body.innerHTML = items.map((item, index) => /*html*/`
        <tr name="task-row" data-stem="${escapeHtml(item.stem)}" class="border-b border-gray-100 cursor-pointer hover:bg-lime/20 text-sm align-top bg-gray-50">
            <td class="px-2 py-1 text-gray-500">${index + 1}</td>
            <td class="px-2 py-1 text-gray-600 break-all">${escapeHtml(item.name)}</td>
            <td class="px-2 py-1 text-gray-600">${escapeHtml(item.prompt)}</td>
            <td class="px-2 py-1 text-gray-500">
                <button class="task-mini-button" data-move="up" title="Move up"><span class="material-symbols-outlined">keyboard_arrow_up</span></button>
                <button class="task-mini-button" data-move="down" title="Move down"><span class="material-symbols-outlined">keyboard_arrow_down</span></button>
            </td>
        </tr>
    `).join("");

    body.querySelectorAll("tr[name='task-row']").forEach((row) => {
        const stem = (row as HTMLElement).dataset.stem || "";
        row.addEventListener("click", (event) => {
            if ((event.target as HTMLElement).closest("button")) return;
            loadTaskMotion(stem).catch((error) => alert((error as Error).message || String(error)));
        });
        row.querySelector('[data-move="up"]')?.addEventListener("click", () => moveItem(stem, -1));
        row.querySelector('[data-move="down"]')?.addEventListener("click", () => moveItem(stem, 1));
    });
}

async function showLatestTask() {
    const data = await fetch(`${g.BACKEND_URL}/kimodo/task/tasks`).then(isOk);
    const task = data.tasks?.[0] as Task | undefined;
    if (!task) {
        renderSequence();
        return;
    }
    currentTask = task;
    sequence = task.sequence?.length ? [...task.sequence] : task.items.map((item) => item.stem);
    setStatus(`${task.name || task.task_id}: ${task.status}`);
    renderSequence();
}

async function loadTaskById(taskId: string) {
    if (!taskId) return;
    const data = await fetch(`${g.BACKEND_URL}/kimodo/task/task/${encodeURIComponent(taskId)}`).then(isOk);
    currentTask = data.task as Task;
    sequence = currentTask.sequence?.length ? [...currentTask.sequence] : currentTask.items.map((item) => item.stem);
    setStatus(`${currentTask.name || currentTask.task_id}: ${currentTask.status}`);
    renderSequence();
}

async function refreshTaskDropdown(selectTaskId?: string) {
    const select = document.getElementById("task-select") as HTMLSelectElement | null;
    if (!select) return;
    const data = await fetch(`${g.BACKEND_URL}/kimodo/task/tasks`).then(isOk);
    const tasks = (data.tasks || []) as Task[];
    const firstUsableTask = tasks.find((task) => task.status !== "error" && task.items?.length);
    select.innerHTML = tasks.length
        ? tasks.map((task) => /*html*/`
            <option value="${escapeHtml(task.task_id)}">${escapeHtml(task.status === "error" ? `[error] ${task.name || task.task_id}` : task.name || task.task_id)}</option>
        `).join("")
        : `<option value="">No generated tasks</option>`;
    const target = selectTaskId || currentTask?.task_id || firstUsableTask?.task_id || tasks[0]?.task_id || "";
    select.value = target;
    if (target) await loadTaskById(target);
    else renderSequence();
}

async function pollJob(jobId: string) {
    while (active) {
        const data = await fetch(`${g.BACKEND_URL}/kimodo/task/job/${jobId}`).then(isOk);
        const job = data.job || {};
        setStatus(`TASK: ${job.status || "running"} ${job.current_index ? `${job.current_index}/${job.total}` : ""}`);
        if (job.status === "done") {
            await refreshTaskDropdown(job.task_id);
            return;
        }
        if (job.status === "error") throw new Error(job.error || "Task generation failed.");
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
}

async function generateTask() {
    const prompts = promptRows().map((input) => input.value.trim()).filter(Boolean);
    if (!prompts.length) {
        setStatus("Add at least one prompt.");
        return;
    }
    const button = document.getElementById("task-generate") as HTMLButtonElement | null;
    if (button) button.disabled = true;
    try {
        setStatus("Sending TASK prompts to Kimodo...");
        const data = await fetch(`${g.BACKEND_URL}/kimodo/task/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompts }),
        }).then(isOk);
        await pollJob(data.job_id);
    } catch (error) {
        setStatus((error as Error).message || String(error));
    } finally {
        if (button) button.disabled = false;
    }
}

async function playSequence() {
    if (playingSequence) {
        playingSequence = false;
        g.PLAYING = false;
        setStatus("Sequence stopped.");
        return;
    }
    const items = orderedItems();
    if (!items.length) {
        setStatus("No sequence to play.");
        return;
    }

    playingSequence = true;
    const button = document.getElementById("task-play-sequence");
    if (button) button.textContent = "Stop";
    try {
        for (const item of items) {
            if (!playingSequence) break;
            setStatus(`Playing ${item.name}`);
            await loadTaskMotion(item.stem);
            g.FRAME = 0;
            g.LOOP_START = 0;
            g.LOOP_END = (g.MODEL3D as any).anim?.maxFrame || 0;
            g.PLAYING = true;
            const fps = Math.max(1, Number((g.MODEL3D as any).anim?.fps || 30));
            const durationMs = ((g.LOOP_END + 1) / fps) * 1000;
            await new Promise((resolve) => window.setTimeout(resolve, durationMs));
            g.PLAYING = false;
        }
    } catch (error) {
        setStatus((error as Error).message || String(error));
    } finally {
        playingSequence = false;
        if (button) button.textContent = "Play Sequence";
    }
}

export function showTaskMotion() {
    active = true;
    setActiveNav("task");
    const browser = document.getElementById("browser");
    if (!browser) return;
    browser.className = "flex flex-col h-full w-full";
    browser.innerHTML = /*html*/`
        <div class="flex flex-col gap-2 p-2 flex-none">
            <select id="task-select" class="myselect px-2 py-1.5 text-sm bg-white border border-gray-300 rounded-lg">
                <option value="">Loading tasks...</option>
            </select>
            <div id="task-prompts" class="flex flex-col gap-1"></div>
            <div class="flex items-center gap-2">
                <button id="task-add-prompt" class="task-icon-button" title="Add prompt"><span class="material-symbols-outlined">add</span></button>
                <button id="task-generate" class="mybutton">Generate Continuous Task</button>
                <button id="task-play-sequence" class="mybutton">Play Task</button>
            </div>
            <div id="task-status" class="text-xs text-gray-500 truncate">Ready.</div>
        </div>
        <table class="w-full table-fixed flex-none">
            <tr>
                <th class="text-left px-2 py-2 bg-white border-b border-gray-200 text-sm font-semibold text-gray-700 w-8">#</th>
                <th class="text-left px-2 py-2 bg-white border-b border-gray-200 text-sm font-semibold text-gray-700">File</th>
                <th class="text-left px-2 py-2 bg-white border-b border-gray-200 text-sm font-semibold text-gray-700">Prompt sequence</th>
                <th class="text-left px-2 py-2 bg-white border-b border-gray-200 text-sm font-semibold text-gray-700 w-16">Order</th>
            </tr>
        </table>
        <div class="flex-1 overflow-auto">
            <table class="w-full table-fixed">
                <tbody id="task-sequence-body"></tbody>
            </table>
        </div>
    `;
    addPromptRow();
    addPromptRow();
    document.getElementById("task-add-prompt")?.addEventListener("click", () => addPromptRow());
    document.getElementById("task-generate")?.addEventListener("click", generateTask);
    document.getElementById("task-play-sequence")?.addEventListener("click", playSequence);
    document.getElementById("task-select")?.addEventListener("change", (event) => {
        loadTaskById((event.target as HTMLSelectElement).value).catch((error) => {
            setStatus((error as Error).message || String(error));
        });
    });
    refreshTaskDropdown().catch((error) => setStatus((error as Error).message || String(error)));
}

export function initTaskMotion() {
    (window as any).showTaskMotion = showTaskMotion;
}
