import { g, MODEL_CONFIGS, ModelType } from "./globals.ts";
import { init3DModel, disposeModel3D } from "./models.ts";
// @ts-ignore
import { applySceneForModel } from "./threejs_builtin.js";
import { refreshSettingsPanel } from "./settings_panel.ts";
import { requestBVH } from "./browser/__requestBVH.ts";

import somaIconUrl from "../images/soma_icon.png";
import g1IconUrl from "../images/g1_icon.png";
import t2IconUrl from "../images/t2_icon.png";

const ICON_URLS: Record<string, string> = {
    soma: somaIconUrl,
    g1: g1IconUrl,
    t2: t2IconUrl,
};

export function initModelSelector() {
    const div = document.getElementById("model-selector")!;

    const ICON_MODELS: { key: string; icon: string }[] = Object.entries(MODEL_CONFIGS)
        .filter(([, config]) => !config.hidden)
        .map(([key]) => ({
            key,
            icon: ICON_URLS[key] || `./images/${key}_icon.png`,
        }));

    div.innerHTML = ICON_MODELS.map(({ key, icon }) => `
        <button data-model="${key}" style="
            width: 100px;
            height: 100px;
            padding: 0;
            border: 3px solid transparent;
            border-radius: 16px;
            background: var(--theme-btn-bg);
            cursor: pointer;
            overflow: hidden;
            transition: border-color 0.15s, background 0.15s;
            display: flex;
            align-items: center;
            justify-content: center;
        ">
            <img src="${icon}" alt="${key}" style="width: 100%; height: 100%; object-fit: contain; pointer-events: none;" />
        </button>
    `).join('');

    const buttons = div.querySelectorAll<HTMLButtonElement>("button[data-model]");

    function updateActiveState() {
        buttons.forEach(btn => {
            const isActive = btn.dataset.model === g.CURRENT_MODEL;
            btn.style.borderColor = isActive ? "var(--theme-accent)" : "transparent";
            btn.style.background = isActive ? "var(--theme-accent-hover)" : "var(--theme-btn-bg)";
        });
    }

    updateActiveState();

    buttons.forEach(btn => {
        btn.addEventListener("mouseenter", () => {
            if (btn.dataset.model !== g.CURRENT_MODEL) {
                btn.style.borderColor = "var(--theme-accent-hover-half)";
            }
        });
        btn.addEventListener("mouseleave", () => {
            updateActiveState();
        });
    });

    async function switchModel(newModelType: ModelType) {
        if (newModelType === g.CURRENT_MODEL) return;

        // Save current state before switching
        const savedAnimName = g.FILENAME;
        const savedPlaying = g.PLAYING;
        const savedFollowing = g.CAMCON?.following ?? false;
        const savedSkeletonVisible = g.MODEL3D?.skeletonHelper?.visible ?? false;

        g.SPINNER.show("Switching model");

        try {
            // Remove current model from scene
            if (g.MODEL3D && g.MODEL3D.object) {
                g.SCENE.remove(g.MODEL3D.object);
                disposeModel3D();
            }

            // Update current model type
            g.CURRENT_MODEL = newModelType;

            // Load new model
            const config = MODEL_CONFIGS[newModelType];
            await init3DModel(config.url, config.scale, config.rotation);

            // Add new model to scene
            g.SCENE.add(g.MODEL3D.object);

            // Apply per-model scene settings (lights, camera)
            applySceneForModel(newModelType);
            refreshSettingsPanel();

            // Load the same animation for the new model (if one was playing)
            if (savedAnimName) {
                await requestBVH({ val: savedAnimName });
            } else {
                // No animation was loaded yet — load first from browser table
                const firstRow = document.querySelector('#browser-table tr[name="datarow"]');
                if (firstRow) {
                    (firstRow as HTMLElement).click();
                }
            }

            // Restore playback state
            g.PLAYING = savedPlaying;
            if (g.CAMCON) g.CAMCON.following = savedFollowing;
            if (g.MODEL3D?.skeletonHelper) {
                g.MODEL3D.skeletonHelper.visible = savedSkeletonVisible;
            }

            // Update timeline button UI to match restored state
            refreshTimelineButtons();

        } catch (error) {
            console.error("Failed to switch model:", error);
            alert("Failed to load model. Check console for details.");
        } finally {
            updateActiveState();
            g.SPINNER.hide("Switching model");
        }
    }

    buttons.forEach(btn => {
        btn.addEventListener("click", () => {
            switchModel(btn.dataset.model as ModelType);
        });
    });
}

function refreshTimelineButtons() {
    // Play/pause
    const playBtn = document.getElementById("playButton");
    const pauseBtn = document.getElementById("pauseButton");
    if (playBtn && pauseBtn) {
        if (g.PLAYING) {
            pauseBtn.style.display = "block";
            playBtn.style.display = "none";
        } else {
            playBtn.style.display = "block";
            pauseBtn.style.display = "none";
        }
    }
    // Follow
    const followBtn = document.getElementById("followButton");
    if (followBtn) {
        followBtn.classList.toggle("text-gray-700", !!g.CAMCON?.following);
    }
    // Skeleton
    const skelBtn = document.getElementById("skeletonButton");
    if (skelBtn) {
        skelBtn.classList.toggle("text-gray-700", !!g.MODEL3D?.skeletonHelper?.visible);
    }
}
