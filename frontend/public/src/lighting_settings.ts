import { g, ModelType } from "./globals.ts";
// @ts-ignore
import { regenerateEnvMap, loadHDREnvMap } from "./threejs_builtin.js";


export interface LightingSettings {
    version: number;

    hemi_intensity: number;
    hemi_skyR: number; hemi_skyG: number; hemi_skyB: number;
    hemi_groundR: number; hemi_groundG: number; hemi_groundB: number;

    key_intensity: number;
    key_colorR: number; key_colorG: number; key_colorB: number;
    key_posX: number; key_posY: number; key_posZ: number;

    fill_intensity: number;
    fill_colorR: number; fill_colorG: number; fill_colorB: number;
    fill_posX: number; fill_posY: number; fill_posZ: number;

    rim_intensity: number;
    rim_colorR: number; rim_colorG: number; rim_colorB: number;
    rim_posX: number; rim_posY: number; rim_posZ: number;

    env_skyR: number; env_skyG: number; env_skyB: number;
    env_groundR: number; env_groundG: number; env_groundB: number;
    env_keySpotIntensity: number;
    env_fillSpotIntensity: number;
    env_showBackground: number; // 0 = off, 1 = show env map as scene background
    env_useHDR: number;         // 0 = procedural, 1 = HDR file
    env_hdrIntensity: number;   // multiplier for HDR env map lighting

    toneMappingExposure: number;
    cssSaturate: number;
    cssContrast: number;

    // Material: body (white/light parts)
    mat_bodyR: number; mat_bodyG: number; mat_bodyB: number;
    mat_bodyMetalness: number;
    mat_bodyRoughness: number;
    mat_bodyEnvMapIntensity: number;

    // Material: dark parts
    mat_darkR: number; mat_darkG: number; mat_darkB: number;
    mat_darkMetalness: number;
    mat_darkRoughness: number;
    mat_darkEnvMapIntensity: number;

}

type MaterialKeys = 'version'
    | 'mat_bodyR' | 'mat_bodyG' | 'mat_bodyB' | 'mat_bodyMetalness' | 'mat_bodyRoughness' | 'mat_bodyEnvMapIntensity'
    | 'mat_darkR' | 'mat_darkG' | 'mat_darkB' | 'mat_darkMetalness' | 'mat_darkRoughness' | 'mat_darkEnvMapIntensity';

const SHARED_LIGHTING: Omit<LightingSettings, MaterialKeys> = {
    hemi_intensity: 0.4,
    hemi_skyR: 1.0, hemi_skyG: 1.0, hemi_skyB: 1.0,
    hemi_groundR: 0.6, hemi_groundG: 0.6, hemi_groundB: 0.6,

    key_intensity: 0.20,
    key_colorR: 1.0, key_colorG: 1.0, key_colorB: 1.0,
    key_posX: -3, key_posY: 4, key_posZ: -2,

    fill_intensity: 2.05,
    fill_colorR: 1.0, fill_colorG: 1.0, fill_colorB: 1.0,
    fill_posX: 3, fill_posY: 3, fill_posZ: 2,

    rim_intensity: 2.15,
    rim_colorR: 0.85, rim_colorG: 0.93, rim_colorB: 1.0,
    rim_posX: 2, rim_posY: 3, rim_posZ: -4,

    env_skyR: 1.5, env_skyG: 1.5, env_skyB: 1.5,
    env_groundR: 0.0, env_groundG: 0.0, env_groundB: 0.0,
    env_keySpotIntensity: 8.0,
    env_fillSpotIntensity: 8.0,
    env_showBackground: 0,
    env_useHDR: 0,
    env_hdrIntensity: 1.0,

    toneMappingExposure: 1.16,
    cssSaturate: 1.01,
    cssContrast: 1.0,
};

const SOMA_DEFAULTS: LightingSettings = {
    version: 9,
    ...SHARED_LIGHTING,

    // SOMA: HDR env map + fill/rim lights
    hemi_intensity: 0.8,
    key_intensity: 1.65,
    fill_intensity: 2.0,
    rim_intensity: 4.3,
    env_skyR: 1.5, env_skyG: 1.49, env_skyB: 1.49,
    env_groundR: 0.13, env_groundG: 0.13, env_groundB: 0.13,
    env_keySpotIntensity: 0,
    env_fillSpotIntensity: 0,
    env_useHDR: 1,
    env_hdrIntensity: 2.5,
    toneMappingExposure: 1.25,
    cssSaturate: 0.20,

    // SOMA: textured model — white tint so textures show as-is
    mat_bodyR: 1.0, mat_bodyG: 1.0, mat_bodyB: 1.0,
    mat_bodyMetalness: 0.33,
    mat_bodyRoughness: 0.34,
    mat_bodyEnvMapIntensity: 1.0,

    mat_darkR: 0.8, mat_darkG: 0.8, mat_darkB: 0.85,
    mat_darkMetalness: 0.9,
    mat_darkRoughness: 0.5,
    mat_darkEnvMapIntensity: 1.0,
};

const G1_DEFAULTS: LightingSettings = {
    version: 7,
    ...SHARED_LIGHTING,

    // G1: white metallic body
    mat_bodyR: 0.82, mat_bodyG: 0.82, mat_bodyB: 0.84,
    mat_bodyMetalness: 0.35,
    mat_bodyRoughness: 0.3,
    mat_bodyEnvMapIntensity: 1.2,

    // G1: glossy dark parts
    mat_darkR: 0.02, mat_darkG: 0.02, mat_darkB: 0.03,
    mat_darkMetalness: 1.0,
    mat_darkRoughness: 0.85,
    mat_darkEnvMapIntensity: 1.2,
};

export const LIGHTING_DEFAULTS: Record<ModelType, LightingSettings> = {
    soma: { ...SOMA_DEFAULTS },
    g1: { ...G1_DEFAULTS },
    t2: { ...G1_DEFAULTS },
};

function storageKey(modelType: ModelType): string {
    return `viewer_lighting_${modelType}`;
}

export function loadSettings(modelType: ModelType): LightingSettings {
    const defaults = LIGHTING_DEFAULTS[modelType];
    try {
        const raw = localStorage.getItem(storageKey(modelType));
        if (!raw) return { ...defaults };
        const saved = JSON.parse(raw) as Partial<LightingSettings>;
        // Version mismatch: discard saved settings and use new defaults
        if (saved.version !== defaults.version) {
            localStorage.removeItem(storageKey(modelType));
            return { ...defaults };
        }
        // Merge: defaults fill any missing fields
        return { ...defaults, ...saved };
    } catch {
        return { ...defaults };
    }
}

export function saveSettings(modelType: ModelType, settings: LightingSettings): void {
    localStorage.setItem(storageKey(modelType), JSON.stringify(settings));
}

export function resetSettings(modelType: ModelType): LightingSettings {
    localStorage.removeItem(storageKey(modelType));
    return { ...LIGHTING_DEFAULTS[modelType] };
}

export function applyLightingSettings(s: LightingSettings): void {
    const hemi = g.HEMISPHERE_LIGHT;
    const dir = g.DIRECTIONAL_LIGHT;
    const fill = g.FILL_LIGHT;
    const rim = g.RIM_LIGHT;

    if (hemi) {
        hemi.intensity = s.hemi_intensity;
        hemi.color.setRGB(s.hemi_skyR, s.hemi_skyG, s.hemi_skyB);
        hemi.groundColor.setRGB(s.hemi_groundR, s.hemi_groundG, s.hemi_groundB);
    }

    if (dir) {
        dir.intensity = s.key_intensity;
        dir.color.setRGB(s.key_colorR, s.key_colorG, s.key_colorB);
        dir.position.set(s.key_posX, s.key_posY, s.key_posZ);
    }

    if (fill) {
        fill.intensity = s.fill_intensity;
        fill.color.setRGB(s.fill_colorR, s.fill_colorG, s.fill_colorB);
        fill.position.set(s.fill_posX, s.fill_posY, s.fill_posZ);
    }

    if (rim) {
        rim.intensity = s.rim_intensity;
        rim.color.setRGB(s.rim_colorR, s.rim_colorG, s.rim_colorB);
        rim.position.set(s.rim_posX, s.rim_posY, s.rim_posZ);
    }

    if (g.RENDERER) {
        g.RENDERER.toneMappingExposure = s.toneMappingExposure;
        g.RENDERER.domElement.style.filter = `saturate(${s.cssSaturate}) contrast(${s.cssContrast})`;
    }

    if (g.SCENE) {
        g.SCENE.background = s.env_showBackground ? g.SCENE.environment : null;
        if (s.env_useHDR) {
            g.SCENE.environmentIntensity = s.env_hdrIntensity;
        }
    }

    applyMaterialSettings(s);
}

export async function applyAndRegenerateEnvMap(s: LightingSettings): Promise<void> {
    applyLightingSettings(s);
    if (s.env_useHDR) {
        await loadHDREnvMap(s.env_hdrIntensity);
    } else {
        regenerateEnvMap(
            [s.env_skyR, s.env_skyG, s.env_skyB],
            [s.env_groundR, s.env_groundG, s.env_groundB],
            s.env_keySpotIntensity,
            s.env_fillSpotIntensity,
        );
    }
    // Re-link background after env map was regenerated
    if (g.SCENE) {
        g.SCENE.background = s.env_showBackground ? g.SCENE.environment : null;
    }
}

// Dark-part mesh name fragments (must match models.ts DARK_PARTS)
const DARK_PARTS = [
    'ankle_roll_link', 'rubber_hand', 'hip_pitch_link',
    '_pelvis_visual', 'head_link', '_logo_link_visual',
];

function applyMaterialSettings(s: LightingSettings): void {
    if (!g.MODEL3D || !g.MODEL3D.object) return;

    g.MODEL3D.object.traverse((child: any) => {
        if (!child.isMesh || !child.material) return;
        const mat = child.material;
        if (!mat.isMeshStandardMaterial) return;

        const name = (child.name || '').toLowerCase();
        const isDark = DARK_PARTS.some(part => name.includes(part));

        if (isDark) {
            mat.color.setRGB(s.mat_darkR, s.mat_darkG, s.mat_darkB);
            mat.metalness = s.mat_darkMetalness;
            mat.roughness = s.mat_darkRoughness;
            mat.envMapIntensity = s.mat_darkEnvMapIntensity;
        } else {
            mat.color.setRGB(s.mat_bodyR, s.mat_bodyG, s.mat_bodyB);
            mat.metalness = s.mat_bodyMetalness;
            mat.roughness = s.mat_bodyRoughness;
            mat.envMapIntensity = s.mat_bodyEnvMapIntensity;
        }
    });
}
