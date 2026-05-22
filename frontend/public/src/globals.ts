import {Animation} from "./animation.ts";
import {Model3D, Model3DG1, Model3DT2} from "./models.ts";

// Import model files so Vite bundles them
// @ts-ignore
import G1ModelUrl from "/models3D/g1/g1_Zup_robot_01.fbx";
// @ts-ignore
import SomaModelUrl from "/models3D/SOMA/soma_male_skel_minimal.fbx";

export type ModelType = 'soma' | 'g1' | 't2';

export interface ModelConfig {
    name: string;
    url: string;
    scale: number;
    rotation: [number, number, number];
    animFormat: 'bvh' | 'csv';
    animEndpoint: string;
    hidden?: boolean;
}

export const MODEL_CONFIGS: Record<ModelType, ModelConfig> = {
    soma: {
        name: 'SOMA',
        url: SomaModelUrl,
        scale: 0.01,
        rotation: [0, 0, 0],
        animFormat: 'bvh',
        animEndpoint: '/storage_local/somabvh/'
    },
    g1: {
        name: 'G1',
        url: G1ModelUrl,
        scale: 1.0,
        rotation: [-Math.PI / 2, 0, 0],
        animFormat: 'csv',
        animEndpoint: '/storage_local/g1csv/'
    },
    t2: {
        name: 'T2',
        url: '/models3D/t2/T2_serial_nero_arms.urdf',
        scale: 0.9589869491995866,
        rotation: [-Math.PI / 2, 0, 0],
        animFormat: 'csv',
        animEndpoint: '/storage_local/t2csv/'
    }
};

interface Globals {
    PROMPT: string;
    STATS: any;
    RENDERER: any,
    SCENE: any,
    CAMERA: any,
    CONTROLS: any,
    CLOCK: any,
    DELTA_TIME: number,
    ANIMATION: Animation,
    FRAME: number,
    PLAYING: boolean,
    MODEL3D: Model3D | Model3DG1 | Model3DT2,
    HEMISPHERE_LIGHT: any,
    DIRECTIONAL_LIGHT: any,
    FILL_LIGHT: any,
    RIM_LIGHT: any,
    CAMCON: any,
    UPDATE_LOOP: {[key: string]: () => void},
    SPINNER: any,
    BROWSER: any,
    GUI: any,
    BACKEND_URL: string,
    FILENAME: string,
    DEFAULT_WORKSPACE: number,
    URL_PARAMS: URLSearchParams,
    LOOP_START: number,
    LOOP_END: number,
    DEFAULT_BROWSER_MODE: "localFiles",
    CURRENT_MODEL: ModelType
}

// @ts-ignore
export const g: Globals = window.g = {
    RENDERER: {} as any,
    SCENE: {} as any,
    CAMERA: {} as any,
    CONTROLS: {} as any,
    CLOCK: {} as any,
    DELTA_TIME: 0,
    FRAME: 0,
    PLAYING: false,
    CAMCON: {} as any,
    UPDATE_LOOP: {} as any,
    SPINNER: {} as any,
    BROWSER: {} as any,
    GUI: {} as any,
    BACKEND_URL: "/api", // replace frontend port with backend port
    DEFAULT_WORKSPACE: 3,
    FILENAME: "",
    STATS: undefined,
    PROMPT: "",
    URL_PARAMS: new URLSearchParams(window.location.search),
    DEFAULT_BROWSER_MODE: "localFiles",
    CURRENT_MODEL: "soma" as ModelType

} 
