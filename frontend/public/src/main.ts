import * as THREE from 'three';
(window as any).THREE = THREE;

// @ts-ignore
import { initTimeline } from "./timeline.js";
// @ts-ignore
import { initScene, applySceneForModel } from "./threejs_builtin.js";
import { init3DModel } from "./models.ts";
import { g, MODEL_CONFIGS } from "./globals.ts";
import "./spinner.ts";
import {initBrowser} from "./browser/initBrowser.ts";
import {initDivider} from "./divider.ts";
import {resizeViewport} from "./viewport.ts";
import {initSpinner} from "./spinner.ts";
import {initMetadataViewer } from "./metadata_viewer.ts";

import {initDownloadAnimButton } from "./download_anim.ts";
import {initModelSelector} from "./model_selector.ts";
import {initViewCube, updateViewCube} from "./view_cube.ts";
import {initProjectionToggle} from "./projection_toggle.ts";
import {initSettingsPanel} from "./settings_panel.ts";
import {initTemporalLabels} from "./temporal_labels.ts";
import {initTheme} from "./theme.ts";
import {initT2RobotControls} from "./t2_robot_controls.ts";
import {initGeneratedMotionPrompt} from "./generated_motion_prompt.ts";

////////////////////////////////////////////////////////////////////////////////////////////////////////////

(async () => {
    initTheme();
    initSpinner();
    g.SPINNER.show()


    const defaultConfig = MODEL_CONFIGS[g.CURRENT_MODEL];
    const urlModel3D = defaultConfig.url;
    const rotation = defaultConfig.rotation;
    const scale = defaultConfig.scale;

    const canvas = document.getElementById("3d-viewport");
    g.UPDATE_LOOP = {};
    initScene(canvas);
    // Apply saved/default lighting for the initial model
    applySceneForModel(g.CURRENT_MODEL);


    (async () => {
        g.PLAYING = true;
        g.FRAME = 0;
        g.PROMPT = "Walking";

        initDownloadAnimButton();
        initModelSelector();
        initViewCube();
        initProjectionToggle();
        initSettingsPanel();
        initT2RobotControls();
        initGeneratedMotionPrompt();

        initMetadataViewer();
        await init3DModel(urlModel3D, scale, rotation);
                    
        initTimeline();
        initTemporalLabels();
        initBrowser();
        initDivider();

        g.SCENE.add(g.MODEL3D.object);
        animate();
        g.SPINNER.hide()
        document.getElementById("loading-screen")!.remove();
        
    })();
})();








////////////////////////////////////////////////////////////////////////////////////////////////////////////

let loopIter = 0;
function animate() {
    g.DELTA_TIME = g.CLOCK.getDelta();

    // if delta time is too big, skip frame
    if (g.DELTA_TIME > 1) {
        g.DELTA_TIME = 0;
    }

    
    if (g.MODEL3D && g.MODEL3D.anim) {
        g.MODEL3D.setFrame(g.FRAME);
        // Force bone world matrices to update before render so SkeletonHelper
        // (which lives at scene root) reads current-frame positions, not stale ones.
        g.MODEL3D.object.updateMatrixWorld(true);

        if (g.PLAYING) {
            g.FRAME = (g.FRAME + g.DELTA_TIME * g.MODEL3D.anim.fps)
            if (g.FRAME > g.LOOP_END || g.FRAME < g.LOOP_START) {
                g.FRAME = g.LOOP_START
            }
            // g.FRAME = g.FRAME % g.LOOP_END;
        }
    }

    if (g.CAMCON.following && g.MODEL3D && g.MODEL3D.anim) {
        const followPos = g.MODEL3D.getRootWorldPosition();
        followPos.y -= 0.2; // offset so hips land at viewport center
        g.CAMCON.followTarget(followPos);
    }

    //// play all registered update functions
    Object.values(g.UPDATE_LOOP).forEach(f => f());

    if (!g.CAMCON._viewCubeAnimating) g.CAMCON.controls.update()
    g.STATS.update()
    updateViewCube();
    g.RENDERER.render(g.SCENE, g.CAMCON.camera);

    resizeViewport();

    requestAnimationFrame(animate);

    loopIter++;
}
