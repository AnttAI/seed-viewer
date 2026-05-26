import { g } from "./globals.ts";
import { loadBVHString } from "./animation.ts";
import { loadG1CSVString } from "./g1_animation.ts";
import { createLocalFilesBrowser } from "./browser/__createLocalFilesBrowser.ts";
import { isOk } from "./helpers.js";

type GeneratedMotion = {
    stem: string;
    name: string;
    prompt: string;
    has_bvh: boolean;
    has_t2_csv: boolean;
};

let active = false;
let statusEl: HTMLDivElement | null = null;
let generateButton: HTMLButtonElement | null = null;

function setActiveNav(nav: string) {
    document.querySelectorAll(".nav-btn").forEach((item) => {
        item.classList.toggle("nav-btn-active", item.getAttribute("data-nav") === nav);
    });
}

function setStatus(message: string) {
    if (statusEl) statusEl.textContent = message;
}

async function fetchGeneratedMotions(): Promise<GeneratedMotion[]> {
    const data = await fetch(`${g.BACKEND_URL}/kimodo/generated/motions`).then(isOk);
    return data.motions || [];
}

async function loadGeneratedMotion(stem: string) {
    try {
        g.SPINNER.show("Loading generated motion");
        const data = await fetch(`${g.BACKEND_URL}/kimodo/generated/motion/${encodeURIComponent(stem)}`).then(isOk);
        if (g.CURRENT_MODEL === "t2") {
            if (!data.csv) throw new Error("Generated motion has no T2 CSV yet.");
            await loadG1CSVString(data.csv, data.name, false, {
                Name: data.name,
                Stem: data.stem,
                Source: "GENMP",
            });
        } else {
            if (!data.bvh) throw new Error("Generated motion has no BVH yet.");
            await loadBVHString(data.bvh, data.name, false, {
                Name: data.name,
                Stem: data.stem,
                Source: "GENMP",
            });
        }
    } catch (error) {
        alert((error as Error).message || String(error));
    } finally {
        g.SPINNER.hide("Loading generated motion");
    }
}

async function renderGeneratedRows() {
    const tbody = document.getElementById("genmp-table-body");
    if (!tbody) return;

    const motions = await fetchGeneratedMotions();
    if (!motions.length) {
        tbody.innerHTML = /*html*/`
            <tr>
                <td class="px-2 py-3 text-sm text-gray-400" colspan="3">No generated motions yet.</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = motions.map((motion) => /*html*/`
        <tr name="genmp-row" data-stem="${motion.stem}" class="border-b border-gray-100 cursor-pointer hover:bg-lime/20 text-sm align-top bg-gray-50">
            <td class="px-2 py-1 text-gray-600 break-all">${motion.name}</td>
            <td class="px-2 py-1 text-gray-600">${motion.prompt}</td>
            <td class="px-2 py-1 text-gray-500">${motion.has_bvh ? "BVH" : ""}${motion.has_bvh && motion.has_t2_csv ? " + " : ""}${motion.has_t2_csv ? "T2" : ""}</td>
        </tr>
    `).join("");

    tbody.querySelectorAll("tr[name='genmp-row']").forEach((row) => {
        row.addEventListener("click", () => {
            tbody.querySelectorAll("tr[name='genmp-row']").forEach((item) => {
                item.classList.remove("bg-lime/30");
            });
            row.classList.add("bg-lime/30");
            loadGeneratedMotion((row as HTMLElement).dataset.stem || "");
        });
    });
}

async function pollJob(jobId: string) {
    while (active) {
        const data = await fetch(`${g.BACKEND_URL}/kimodo/generated/job/${jobId}`).then(isOk);
        const job = data.job || {};
        const status = String(job.status || "running");
        setStatus(status === "done" ? "Generated motion is ready." : `Kimodo: ${status}`);
        if (status === "done") {
            await renderGeneratedRows();
            return;
        }
        if (status === "error") {
            throw new Error(job.error || "Kimodo generation failed.");
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
}

async function generateFromPrompt() {
    const input = document.getElementById("genmp-prompt") as HTMLInputElement | null;
    const prompt = input?.value.trim() || "";
    if (!prompt) {
        setStatus("Enter a prompt first.");
        return;
    }

    if (generateButton) generateButton.disabled = true;
    try {
        setStatus("Sending prompt to Kimodo...");
        const data = await fetch(`${g.BACKEND_URL}/kimodo/generated/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt }),
        }).then(isOk);
        setStatus("Kimodo job queued.");
        await pollJob(data.job_id);
    } catch (error) {
        setStatus((error as Error).message || String(error));
    } finally {
        if (generateButton) generateButton.disabled = false;
    }
}

export function showGeneratedMotionPrompt() {
    active = true;
    setActiveNav("generate-motion");
    const browser = document.getElementById("browser");
    if (!browser) return;

    browser.className = "flex flex-col h-full w-full";
    browser.innerHTML = /*html*/`
        <div class="flex flex-col gap-2 p-2 flex-none">
            <input spellcheck="false" id="genmp-prompt" type="text" placeholder="Describe a motion..." class="w-full px-3 py-1.5 text-sm bg-gray-50 border border-gray-300 rounded-lg focus:border-gray-400 focus:bg-white transition-colors">
            <div class="flex items-center gap-2">
                <button id="genmp-generate" class="mybutton">Generate</button>
                <div id="genmp-status" class="text-xs text-gray-500 truncate">Ready.</div>
            </div>
        </div>
        <table class="w-full table-fixed flex-none">
            <tr>
                <th class="text-left px-2 py-2 bg-white border-b border-gray-200 text-sm font-semibold text-gray-700">Name</th>
                <th class="text-left px-2 py-2 bg-white border-b border-gray-200 text-sm font-semibold text-gray-700">Prompt</th>
                <th class="text-left px-2 py-2 bg-white border-b border-gray-200 text-sm font-semibold text-gray-700">Files</th>
            </tr>
        </table>
        <div class="flex-1 overflow-auto">
            <table class="w-full table-fixed">
                <tbody id="genmp-table-body"></tbody>
            </table>
        </div>
    `;

    statusEl = document.getElementById("genmp-status") as HTMLDivElement | null;
    generateButton = document.getElementById("genmp-generate") as HTMLButtonElement | null;
    generateButton?.addEventListener("click", generateFromPrompt);
    document.getElementById("genmp-prompt")?.addEventListener("keydown", (event) => {
        if ((event as KeyboardEvent).key === "Enter") generateFromPrompt();
    });
    renderGeneratedRows().catch((error) => setStatus((error as Error).message || String(error)));
}

export function showSeedBrowser() {
    active = false;
    setActiveNav("seed");
    createLocalFilesBrowser();
}

export function initGeneratedMotionPrompt() {
    (window as any).showGeneratedMotionPrompt = showGeneratedMotionPrompt;
    (window as any).showSeedBrowser = showSeedBrowser;
}
