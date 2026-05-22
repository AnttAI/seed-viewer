import {lg} from "./__localGlobals"
import {g, MODEL_CONFIGS} from "../globals"
import {loadBVHString} from "../animation.ts"
import {loadG1CSVString} from "../g1_animation.ts"
import { isOk } from "../helpers.js";
import { fetchTemporalLabels } from "../temporal_labels.ts";


/**
 * Request animation data based on current model type.
 * For SOMA: fetches BVH from /storage_local/somabvh/
 * For CSV robots: fetches CSV from the model's configured endpoint.
 */
export async function requestBVH({ random = false, val="" }) {

    //// if there is already a request being made, abort it
    if (lg.CONTROLLER) {
        lg.CONTROLLER.abort();
    }

    //// create new controller and signal
    lg.CONTROLLER = new AbortController();
    lg.SIGNAL = lg.CONTROLLER.signal;

    const currentModelConfig = MODEL_CONFIGS[g.CURRENT_MODEL];

    try {
        g.SPINNER.show()

        let url: string;
        
        // Branch based on animation format (determined by model type)
        if (currentModelConfig.animFormat === 'csv') {
            // Robot models use CSV animations
            if (lg.BROWSER_TYPE === "localFiles") {
                const endpoint = currentModelConfig.animEndpoint;
                url = random ?
                    `${g.BACKEND_URL}${endpoint}?random=true`
                    : `${g.BACKEND_URL}${endpoint}?csvpath=${val}`
            } else {
                alert(`${currentModelConfig.name} CSV animations only supported in localFiles mode`)
                return
            }

            const data = await fetch(url, { signal: lg.SIGNAL }).then(isOk);
            
            if (data.metadata) {
                await loadG1CSVString(data.csv, data.name, true, data.metadata)
            } else {
                await loadG1CSVString(data.csv, data.name, false, null)
            }
        } else {
            // BVH-based models (SOMA) — use animEndpoint from config
            const endpoint = currentModelConfig.animEndpoint;
            url = random ?
                `${g.BACKEND_URL}${endpoint}?random=true`
                : `${g.BACKEND_URL}${endpoint}?bvhpath=${val}`

            const data = await fetch(url, { signal: lg.SIGNAL }).then(isOk);

            if (data.metadata) {
                await loadBVHString(data.tree, data.name, true, data.metadata)
            }
            else  {
                await loadBVHString(data.tree, data.name,  false, null)
            }
        }

        // Fetch temporal labels in background (non-blocking)
        // For non-random: val is the actual filename from the browser table
        // For random: use g.FILENAME set by loadBVHString/loadG1CSVString
        fetchTemporalLabels(random ? g.FILENAME : val);

    } catch (err: any) {
        // Check if the request was aborted
        if (err.name === 'AbortError') {
            console.log('Fetch aborted');
        } else {
            alert(err);
        }
    }
    finally {
        g.SPINNER.hide();
    }
}




