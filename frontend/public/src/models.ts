import { g } from './globals.ts';

import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';
// @ts-ignore
import { SkeletonHelper2, JointHelper } from './customSkeletonHelper.js';
import { Animation } from './animation.ts';
import { G1Animation } from './g1_animation.ts';
import { loadSettings, applyLightingSettings } from './lighting_settings.ts';

// @ts-ignore
import SomaTextureUrl from '/models3D/SOMA/Nova_c_skin_diffuseReflectionColor.1001.png';

export async function init3DModel(modelUrl:string, scale = 1, rotation: [number, number, number] = [0, 0, 0]) {
    // Determine model class based on current model type
    if (g.CURRENT_MODEL === 'g1') {
        g.MODEL3D = new Model3DG1();
        await (g.MODEL3D as Model3DG1).init(modelUrl, scale, rotation);
    } else if (g.CURRENT_MODEL === 't2') {
        g.MODEL3D = new Model3DT2();
        await (g.MODEL3D as Model3DT2).init(modelUrl, scale, rotation);
    } else {
        g.MODEL3D = new Model3D();
        await g.MODEL3D.init(modelUrl, scale, rotation);
    }
}

export function disposeModel3D() {
    if (!g.MODEL3D) return;

    // Call model-specific cleanup if available
    if ('dispose' in g.MODEL3D && typeof (g.MODEL3D as any).dispose === 'function') {
        (g.MODEL3D as any).dispose();
    }

    if (g.MODEL3D.object) {
        // Dispose geometries and materials
        g.MODEL3D.object.traverse((child: any) => {
            if (child.geometry) {
                child.geometry.dispose();
            }
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach((mat: any) => {
                        if (mat.map) mat.map.dispose();
                        mat.dispose();
                    });
                } else {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            }
        });

        // Clear skeleton helper (only on Model3D)
        if ('skeletonHelper' in g.MODEL3D && g.MODEL3D.skeletonHelper) {
            if (g.MODEL3D.skeletonHelper.parent) {
                g.MODEL3D.skeletonHelper.parent.remove(g.MODEL3D.skeletonHelper);
            }
            g.MODEL3D.skeletonHelper.dispose();
        }
    }
}


export class Model3D {
    object!: THREE.Object3D;
    root!: THREE.Bone;
    hips!: THREE.Bone;
    bonesList!: THREE.Bone[];
    skeletonHelper: SkeletonHelper2
    anim!: Animation

    constructor() {
    }

    async init(modelUrl: string, scale:number, rotation: [number, number, number]){
        const fbxLoader = new FBXLoader()
        const modelObject = await fbxLoader.loadAsync(modelUrl)

        const bonesList: THREE.Bone[] = [];
        modelObject.traverse(function (child: any) {
            if (child.isMesh) {
                child.frustumCulled = false;
                child.castShadow = true;
                child.receiveShadow = false;
            }

            // is bone and not a redundant bone (idk why three.js stores them)
            if (child.isBone && child.parent.name !== child.name) {
                bonesList.push(child)
            }
        })


       
        // console.log(object)


        this.object = modelObject;
        this.bonesList = bonesList;

        // Find root bone: first try direct child, then search tree
        this.root = this.object.children.find(child => (child as THREE.Bone).isBone) as THREE.Bone;
        if (!this.root) {
            // Search the entire tree for the first top-level bone
            this.object.traverse((child: any) => {
                if (!this.root && child.isBone) {
                    this.root = child;
                }
            });
        }
        // Find Hips — search by name (SOMA uses "_Hips")
        const hipsNames = ["Hips", "_Hips"];
        this.hips = this.root?.children.find(child => hipsNames.includes(child.name)) as THREE.Bone;
        if (!this.hips && this.root) {
            this.root.traverse((child: any) => {
                if (!this.hips && child.isBone && hipsNames.includes(child.name)) {
                    this.hips = child;
                }
            });
        }

        console.log(`[Model3D] root: "${this.root?.name}", hips: "${this.hips?.name}", bones: ${bonesList.length}`,
            bonesList.map(b => b.name));

        this.object.scale.set(scale, scale, scale)
        this.object.rotation.set(rotation[0], rotation[1], rotation[2], 'YXZ');

        // Apply premium MeshPhysicalMaterial to SOMA
        if (g.CURRENT_MODEL === 'soma') {
            this.applySomaMaterials()
        }


        const helper = new SkeletonHelper2(this.root);
        this.skeletonHelper = helper;
        // SkeletonHelper constructor sets matrix = root.matrixWorld, matrixAutoUpdate = false.
        // Add to scene (not to this.object) so root's matrixWorld handles all positioning
        // without double-applying the object's scale/rotation.
        this.skeletonHelper.material.fog = false;
        this.skeletonHelper.visible = false;
        this.skeletonHelper.frustumCulled = false;

        g.SCENE.add(this.skeletonHelper);

    }

    getRootWorldPosition() {
        const v = new THREE.Vector3();
        const target = this.hips || this.root;
        if (!target) return v;
        target.getWorldPosition(v);
        if (isNaN(v.x) || isNaN(v.y) || isNaN(v.z)) {
            console.error("Root bone position is NaN")
            return new THREE.Vector3(0, 0, 0)
        }
        return v
    }

    getBonePoseLocalRotation(boneName: string, frame:number) : THREE.Quaternion {
      this.anim.anim.clip.tracks.forEach(track => {
        if (track.name.split(".")[0] === boneName && track.name.split(".")[1] === "quaternion") {
           // interpolate
           const quat = track.values.slice(frame * 4, frame * 4 + 4)
           return new THREE.Quaternion(quat[0], quat[1], quat[2], quat[3])
        }
      })
      throw new Error("Bone not found")
    }

    getBonePoseLocalRotationAllBones(frame:number) : { [key: string]: THREE.Quaternion } {
      const rotations: { [key: string]: THREE.Quaternion } = {}
      this.anim.anim.clip.tracks.forEach(track => {
        if (track.name.split(".")[1] === "quaternion") {
           // interpolate
           const quat = track.values.slice(frame * 4, frame * 4 + 4)
           rotations[track.name.split(".")[0]] = new THREE.Quaternion(quat[0], quat[1], quat[2], quat[3])
        }
      })
      return rotations
    }
    
        


/**
 * Convert FBX MeshPhongMaterial → MeshStandardMaterial while preserving textures.
 * After conversion, re-apply saved lighting/material settings.
 */
applySomaMaterials() {
    const textureLoader = new THREE.TextureLoader();
    const somaTexture = textureLoader.load(SomaTextureUrl);
    somaTexture.colorSpace = 'srgb';

    let meshCount = 0;
    this.object.traverse((child: any) => {
        if (!child.isMesh || !child.material) return;
        meshCount++;

        const oldMat = child.material;
        // Convert to MeshStandardMaterial if not already
        if (!oldMat.isMeshStandardMaterial) {
            const newMat = new THREE.MeshStandardMaterial({
                color: oldMat.color ? oldMat.color.clone() : new THREE.Color(0.8, 0.8, 0.85),
                map: somaTexture,
                normalMap: oldMat.normalMap || null,
                metalness: 0.33,
                roughness: 0.34,
                envMapIntensity: 1.0,
                fog: false,
            });
            child.material = newMat;
            oldMat.dispose();
        } else {
            if (!oldMat.map) oldMat.map = somaTexture;
            oldMat.metalness = 0.33;
            oldMat.roughness = 0.34;
            oldMat.envMapIntensity = 1.0;
            oldMat.fog = false;
        }
    });
    console.log(`[SOMA Materials] Converted ${meshCount} meshes to MeshStandardMaterial (textures preserved)`);

    // Re-apply saved settings so slider values override the hardcoded defaults above
    const s = loadSettings(g.CURRENT_MODEL);
    applyLightingSettings(s);
}

  /**
   * 
   * @param {} frame
   */
  setFrame( frame:number) {

    // "frame" can be fractional therefore positions and rotations need to be interpolated
    // between floor(frame) and ceil(frame) using t = frame - floor(frame)
    const framef = Math.floor(frame)
    const framec = Math.ceil(frame)
    const t = frame - framef

    const sourceAnim = this.anim;
    const targetModel3D = this;

    // SOMA FBX bones have underscore prefix (_Hips), BVH tracks use plain names (Hips)
    const isSoma = g.CURRENT_MODEL === 'soma';
    function toBvhName(fbxBoneName: string): string {
      return (isSoma && fbxBoneName.startsWith('_')) ? fbxBoneName.substring(1) : fbxBoneName;
    }

    function __copyRotation(bone: THREE.Bone) {
      const bvhName = toBvhName(bone.name);
      //// find track with the same name as the bone
      sourceAnim.anim.clip.tracks.forEach(track => {
        if (track.name.split(".")[0] === bvhName) {

          if (bvhName === "Hips" && track.name.split(".")[1] === "position") {
            // console.log(track);
            // values contains 3 x num_frames values; we want to take only 3
  
            // interpolate
            let pos = [0, 0, 0];
            const pos1 = track.values.slice(framef * 3, framef * 3 + 3)
            // if frame greater than max frame, then dont interpolate
            if (frame > sourceAnim.maxFrame) {
              pos[0] = pos1[0]
              pos[1] = pos1[1]
              pos[2] = pos1[2]
            } else {
              const pos2 = track.values.slice(framec * 3, framec * 3 + 3) 
              const pos3 = pos1.map((v, i) => v * (1 - t) + pos2[i] * t)
              pos[0] = pos3[0]
              pos[1] = pos3[1]
              pos[2] = pos3[2]
            }
  
            // subtract root bone's rest position
            const rootPos = sourceAnim.anim.skeleton.getBoneByName("Hips")!.position;
            pos[0] -= rootPos.x;
            pos[1] -= rootPos.y;
            pos[2] -= rootPos.z;
            bone.position.set(pos[0], pos[1], pos[2])
          }
          if (track.name.split(".")[1] === "quaternion") {
            // console.log(track);
            // values contains 4 x num_frames values; we want to take only 4
  
  
            // interpolate
            let quat = new THREE.Quaternion();
            const quat1 = track.values.slice(framef * 4, framef * 4 + 4)
            // if frame greater than max frame, then dont interpolate
            if (frame > sourceAnim.maxFrame) {
              quat.set(quat1[0], quat1[1], quat1[2], quat1[3])
            } else {
              const quat2 = track.values.slice(framec * 4, framec * 4 + 4)
              quat.set(quat1[0], quat1[1], quat1[2], quat1[3])
                .slerp(new THREE.Quaternion(quat2[0], quat2[1], quat2[2], quat2[3]), t)
            }
  
            // interpolate quaternions similarly to how we did with position
            bone.rotation.setFromQuaternion(quat)
          }
        }
      })
  
      //// recursively copy rotation for all children
      const children = bone.children.filter(child => (child as THREE.Bone).isBone)
      if (children.length === 0) {
        return;
      }
      children.forEach(child => {
        // three.js stores redundant children (idk why, but it does)
        if (child.name === bone.name) {
          return;
        }
  
        // find bone from bvh with the same name and copy its rotation
        const bvhBone = sourceAnim.anim.skeleton.getBoneByName(toBvhName(child.name));
        if (!bvhBone) {
          return;
        }
  
        // ignore LeftHandThumb1, LeftHandThumb2 and RightHandThumb1, RightHandThumb2
        if (child.name.includes("Thumb")) {
          return;
        }
  
        __copyRotation(child as THREE.Bone)
      })
    }
  
    __copyRotation(targetModel3D.root)
  }

}


type RobotJointInfo = {
    object: THREE.Object3D;
    type: string;
    axis: THREE.Vector3;
    restPosition: THREE.Vector3;
    restQuaternion: THREE.Quaternion;
};

function parseVector(value: string | null, fallback: [number, number, number] = [0, 0, 0]): THREE.Vector3 {
    const parts = (value || '').trim().split(/\s+/).filter(Boolean).map(Number);
    return new THREE.Vector3(
        Number.isFinite(parts[0]) ? parts[0] : fallback[0],
        Number.isFinite(parts[1]) ? parts[1] : fallback[1],
        Number.isFinite(parts[2]) ? parts[2] : fallback[2],
    );
}

function applyOrigin(object: THREE.Object3D, origin: Element | null) {
    if (!origin) return;
    object.position.copy(parseVector(origin.getAttribute('xyz')));
    const rpy = parseVector(origin.getAttribute('rpy'));
    object.quaternion.copy(urdfRpyToQuaternion(rpy.x, rpy.y, rpy.z));
}

function urdfRpyToQuaternion(roll: number, pitch: number, yaw: number): THREE.Quaternion {
    const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), roll);
    const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pitch);
    const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), yaw);
    return qz.multiply(qy).multiply(qx);
}

/**
 * Model3DT2 - T2 robot loaded from URDF/STL assets.
 * The URDF hierarchy supplies real joint axes, then CSV joint columns drive it.
 */
export class Model3DT2 {
    object!: THREE.Object3D;
    joints: Map<string, THREE.Object3D> = new Map();
    jointInfo: Map<string, RobotJointInfo> = new Map();
    skeletonHelper: any = null;
    anim!: G1Animation;

    async init(modelUrl: string, scale: number, rotation: [number, number, number]) {
        console.log('Loading T2 URDF model from:', modelUrl);
        const text = await fetch(modelUrl).then((res) => {
            if (!res.ok) throw new Error(`Failed to load T2 URDF: ${res.status}`);
            return res.text();
        });

        const doc = new DOMParser().parseFromString(text, 'application/xml');
        if (doc.querySelector('parsererror')) throw new Error('Failed to parse T2 URDF');

        const baseUrl = new URL(modelUrl, window.location.href);
        const rootGroup = new THREE.Group();
        rootGroup.name = 'T2';
        rootGroup.scale.set(scale, scale, scale);
        rootGroup.rotation.set(rotation[0], rotation[1], rotation[2], 'YXZ');

        const floatingBase = new THREE.Group();
        floatingBase.name = 'floating_base_joint';
        rootGroup.add(floatingBase);
        this.joints.set(floatingBase.name, floatingBase);
        this.jointInfo.set(floatingBase.name, {
            object: floatingBase,
            type: 'floating',
            axis: new THREE.Vector3(0, 0, 1),
            restPosition: floatingBase.position.clone(),
            restQuaternion: floatingBase.quaternion.clone(),
        });

        const materialColors = this.parseMaterialColors(doc);
        const links = await this.createLinks(doc, baseUrl, materialColors);
        const childLinks = new Set<string>();

        for (const jointEl of Array.from(doc.querySelectorAll('joint'))) {
            const name = jointEl.getAttribute('name') || '';
            const type = jointEl.getAttribute('type') || 'fixed';
            const parentName = jointEl.querySelector('parent')?.getAttribute('link');
            const childName = jointEl.querySelector('child')?.getAttribute('link');
            if (!name || !parentName || !childName) continue;

            const parentLink = links.get(parentName);
            const childLink = links.get(childName);
            if (!parentLink || !childLink) continue;

            const jointObject = new THREE.Group();
            jointObject.name = name;
            applyOrigin(jointObject, jointEl.querySelector('origin'));
            parentLink.add(jointObject);
            jointObject.add(childLink);
            childLinks.add(childName);

            const axis = parseVector(jointEl.querySelector('axis')?.getAttribute('xyz'), [0, 0, 1]).normalize();
            this.joints.set(name, jointObject);
            this.jointInfo.set(name, {
                object: jointObject,
                type,
                axis,
                restPosition: jointObject.position.clone(),
                restQuaternion: jointObject.quaternion.clone(),
            });
        }

        const rootLink = Array.from(links.entries()).find(([name]) => !childLinks.has(name))?.[1] || links.get('pelvis');
        if (rootLink) floatingBase.add(rootLink);

        this.object = rootGroup;
        this.applyT2Materials();

        const helper = new JointHelper(Array.from(this.joints.values()));
        this.skeletonHelper = helper;
        this.skeletonHelper.visible = false;
        g.SCENE.add(this.skeletonHelper);

        console.log('[T2 URDF] Model loaded. Found joints:', Array.from(this.joints.keys()));
    }

    private parseMaterialColors(doc: Document): Map<string, THREE.Color> {
        const colors = new Map<string, THREE.Color>();
        for (const mat of Array.from(doc.documentElement.children).filter(el => el.tagName === 'material')) {
            const name = mat.getAttribute('name');
            const rgba = mat.querySelector('color')?.getAttribute('rgba');
            if (!name || !rgba) continue;
            const values = rgba.trim().split(/\s+/).map(Number);
            colors.set(name, new THREE.Color(values[0] ?? 0.7, values[1] ?? 0.7, values[2] ?? 0.7));
        }
        return colors;
    }

    private async createLinks(doc: Document, baseUrl: URL, materialColors: Map<string, THREE.Color>): Promise<Map<string, THREE.Object3D>> {
        const links = new Map<string, THREE.Object3D>();
        const loader = new STLLoader();

        for (const linkEl of Array.from(doc.querySelectorAll('link'))) {
            const linkName = linkEl.getAttribute('name');
            if (!linkName) continue;

            const linkObject = new THREE.Group();
            linkObject.name = linkName;
            links.set(linkName, linkObject);

            for (const visualEl of Array.from(linkEl.children).filter(el => el.tagName === 'visual')) {
                const filename = visualEl.querySelector('mesh')?.getAttribute('filename');
                if (!filename) continue;

                const visualObject = new THREE.Group();
                visualObject.name = `${linkName}_visual`;
                applyOrigin(visualObject, visualEl.querySelector('origin'));

                const geometry = await loader.loadAsync(new URL(filename, baseUrl).toString());
                geometry.computeVertexNormals();

                const matName = visualEl.querySelector('material')?.getAttribute('name') || '';
                const color = materialColors.get(matName) || new THREE.Color(0.7, 0.7, 0.72);
                const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
                    color,
                    metalness: 0.35,
                    roughness: 0.32,
                    envMapIntensity: 1.2,
                    fog: false,
                }));
                mesh.name = `${linkName}_mesh`;
                mesh.frustumCulled = false;
                mesh.castShadow = true;
                mesh.receiveShadow = false;

                visualObject.add(mesh);
                linkObject.add(visualObject);
            }
        }

        return links;
    }

    private applyT2Materials() {
        const DARK_PARTS = ['head', 'ankle_roll', 'hip_pitch', 'gripper', 'base_link'];
        this.object.traverse((child: any) => {
            if (!child.isMesh) return;
            const name = (child.name || '').toLowerCase();
            const isDark = DARK_PARTS.some(part => name.includes(part));
            child.material.color = isDark ? new THREE.Color(0.08, 0.08, 0.09) : new THREE.Color(0.76, 0.76, 0.78);
            child.material.metalness = isDark ? 0.7 : 0.35;
            child.material.roughness = isDark ? 0.24 : 0.32;
            child.material.envMapIntensity = 1.2;
        });
    }

    getRootWorldPosition(): THREE.Vector3 {
        const v = new THREE.Vector3();
        const root = this.joints.get('floating_base_joint') || this.object;
        root.getWorldPosition(v);
        return (isNaN(v.x) || isNaN(v.y) || isNaN(v.z)) ? new THREE.Vector3(0, 0, 0) : v;
    }

    setFrame(frame: number) {
        if (!this.anim || typeof this.anim.getFrameData !== 'function') return;
        const frameData = this.anim.getFrameData(frame);
        if (!frameData) return;

        const root = this.joints.get('floating_base_joint');
        if (root) {
            const posScale = 0.01;
            root.position.set(
                (frameData.root_translateX ?? 0) * posScale,
                (frameData.root_translateY ?? 0) * posScale,
                (frameData.root_translateZ ?? 0) * posScale
            );
            const rx = THREE.MathUtils.degToRad(frameData.root_rotateX ?? 0);
            const ry = THREE.MathUtils.degToRad(frameData.root_rotateY ?? 0);
            const rz = THREE.MathUtils.degToRad(frameData.root_rotateZ ?? 0);
            root.quaternion.copy(urdfRpyToQuaternion(rx, ry, rz));
        }

        const dofQuat = new THREE.Quaternion();
        for (const [jointName, info] of this.jointInfo) {
            if (jointName === 'floating_base_joint' || info.type === 'fixed') continue;
            const angle = frameData[`${jointName}_dof`];
            if (angle === undefined) continue;

            if (info.type === 'prismatic') {
                const axis = info.axis.clone().applyQuaternion(info.restQuaternion);
                info.object.position.copy(info.restPosition).addScaledVector(axis, THREE.MathUtils.degToRad(angle));
            } else {
                dofQuat.setFromAxisAngle(info.axis, THREE.MathUtils.degToRad(angle));
                info.object.quaternion.copy(info.restQuaternion).multiply(dofQuat);
            }
        }
    }

    dispose() {
        if (this.skeletonHelper) {
            if (this.skeletonHelper.parent) this.skeletonHelper.parent.remove(this.skeletonHelper);
            if (this.skeletonHelper.dispose) this.skeletonHelper.dispose();
            this.skeletonHelper = null;
        }
        this.object.traverse((child: any) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        this.joints.clear();
        this.jointInfo.clear();
    }
}

/**
 * Model3DG1 - G1 Robot model (FBX-based)
 * Loads the G1 robot FBX and applies CSV-based animations
 */
export class Model3DG1 {
    object!: THREE.Object3D;
    joints: Map<string, THREE.Object3D> = new Map();
    restQuaternions: Map<string, THREE.Quaternion> = new Map();
    skeletonHelper: any = null;
    anim!: G1Animation;

    constructor() {
    }

    async init(modelUrl: string, scale: number, rotation: [number, number, number]) {
        console.log('Loading G1 FBX model from:', modelUrl);
        const loader = new FBXLoader();
        
        const model = await new Promise<THREE.Group>((resolve, reject) => {
            loader.load(
                modelUrl,
                (group) => resolve(group),
                (progress) => console.log('G1 FBX loading progress:', Math.round((progress.loaded / progress.total) * 100) + '%'),
                (error) => reject(error)
            );
        });
        
        this.object = model;
        
        // Apply scale and rotation
        this.object.scale.set(scale, scale, scale);
        this.object.rotation.set(rotation[0], rotation[1], rotation[2], 'YXZ');
        
        // Step 1: Collect joints from the skeleton hierarchy
        // FBX may contain duplicate bone names (parent and child with same name).
        // We want the FIRST occurrence (top-level) for each name.
        this.object.traverse((child: any) => {
            if (child.name && (child.name.includes('joint') || child.name === 'root')) {
                if (!this.joints.has(child.name)) {
                    this.joints.set(child.name, child);
                }
            }
        });
        
        // Step 1b: Save rest-pose quaternions for all joints.
        // The FBX rest rotations encode URDF link-frame transforms.
        // Animation joint angles must be composed with these, not replace them.
        for (const [name, joint] of this.joints) {
            this.restQuaternions.set(name, joint.quaternion.clone());
        }
        
        // Step 2: Convert SkinnedMeshes to regular Meshes parented under their joint
        //
        // The FBX has a URDF-style dual hierarchy:
        //   _g1_29dof_grp
        //     ├── _pelvis_grp          (mesh container - each mesh skinned to 1 joint)
        //     └── floating_base_joint  (skeleton hierarchy)
        //
        // Each SkinnedMesh has a 1-bone skeleton. The bone IS the joint node.
        // We convert each to a regular Mesh and parent it directly under its joint,
        // then delete _pelvis_grp. This gives us a clean hierarchy where
        // joint transforms naturally propagate to their meshes.
        
        const skinnedMeshes: any[] = [];
        this.object.traverse((child: any) => {
            if (child.isSkinnedMesh) {
                skinnedMeshes.push(child);
            }
        });
        
        let converted = 0;
        for (const sm of skinnedMeshes) {
            const bone = sm.skeleton?.bones?.[0];
            if (!bone) continue;
            
            // Create regular Mesh with same geometry and material
            const mesh = new THREE.Mesh(sm.geometry, sm.material);
            mesh.name = sm.name;
            mesh.frustumCulled = false;
            mesh.castShadow = true;
            mesh.receiveShadow = false;
            
            // Compute smooth vertex normals (removes faceted/hard-edge shading)
            mesh.geometry.computeVertexNormals();
            
            // Preserve the original SkinnedMesh's local transform.
            // Most meshes have identity (0,0,0) position, but some
            // (e.g. _head_link_visual, _logo_link_visual) have a
            // non-zero position offset that must be kept.
            mesh.position.copy(sm.position);
            mesh.rotation.copy(sm.rotation);
            mesh.scale.copy(sm.scale);
            
            bone.add(mesh);
            
            // Remove original SkinnedMesh from its parent
            if (sm.parent) {
                sm.parent.remove(sm);
            }
            sm.skeleton?.dispose();
            converted++;
        }
        
        // Step 3: Remove the now-empty _pelvis_grp
        const pelvisGrp = this.object.children.find((c: any) => c.name === '_pelvis_grp');
        if (pelvisGrp) {
            this.object.remove(pelvisGrp);
            console.log('[G1 FBX] Removed _pelvis_grp');
        }
        
        console.log('[G1 FBX] Converted', converted, 'SkinnedMeshes to Meshes under joints');
        
        // Step 3b: Upgrade materials to PBR metallic look
        this.applyG1Materials();
        
        // Step 4: Create skeleton helper for "show bones" button
        // Use JointHelper which only draws lines between actual bone/joint
        // objects (avoids picking up Mesh children reparented under joints)
        const jointObjects = Array.from(this.joints.values());
        if (jointObjects.length > 0) {
            const helper = new JointHelper(jointObjects);
            this.skeletonHelper = helper;
            this.skeletonHelper.visible = false;
            g.SCENE.add(this.skeletonHelper);
        }
        
        console.log('[G1 FBX] Model loaded. Found joints:', Array.from(this.joints.keys()));
    }

    /**
     * Apply PBR materials to G1 robot.
     * 
     * Dark parts (same as head): ankle_roll, rubber_hand, hip_pitch, pelvis, head
     * Everything else: white metallic.
     */
    private applyG1Materials() {
        // Explicit list of dark meshes (matched by substring, case-insensitive)
        const DARK_PARTS = [
            'ankle_roll_link',    // _left_ankle_roll_link_visual, _right_ankle_roll_link_visual
            'rubber_hand',        // _left_rubber_hand_visual, _right_rubber_hand_visual
            'hip_pitch_link',     // _left_hip_pitch_link_visual, _right_hip_pitch_link_visual
            '_pelvis_visual',     // _pelvis_visual (but NOT _pelvis_contour_link_visual)
            'head_link',          // _head_link_visual
            '_logo_link_visual'
        ];
        
        const meshNames: string[] = [];
        
        this.object.traverse((child: any) => {
            if (!child.isMesh) return;
            
            const name = (child.name || '').toLowerCase();
            meshNames.push(child.name);
            const oldMat = child.material;
            
            const isDark = DARK_PARTS.some(part => name.includes(part));
            
            let color: THREE.Color;
            let metalness: number;
            let roughness: number;
            let emissive = new THREE.Color(0x000000);
            let emissiveIntensity = 0;
            
            if (isDark) {
                // Dark parts: glossy black metallic
                color = new THREE.Color(0.02, 0.02, 0.03);
                metalness = 0.7;
                roughness = 0.15;
                
                // Subtle blue glow on head only
                if (name.includes('head')) {
                    emissive = new THREE.Color(0x0a1a55);
                    emissiveIntensity = 0.12;
                }
            } else {
                // White metallic body
                color = new THREE.Color(0.82, 0.82, 0.84);
                metalness = 0.35;
                roughness = 0.3;
            }
            
            const mat = new THREE.MeshStandardMaterial({
                color: color,
                metalness: metalness,
                roughness: roughness,
                envMapIntensity: 1.2,
                emissive: emissive,
                emissiveIntensity: emissiveIntensity,
                fog: false,
            });
            
            if (oldMat && oldMat.dispose) oldMat.dispose();
            child.material = mat;
        });
        
        console.log('[G1 Materials] Applied PBR materials to meshes:', meshNames);
    }

    getRootWorldPosition(): THREE.Vector3 {
        const v = new THREE.Vector3();
        const root = this.joints.get('floating_base_joint') || this.object;
        root.getWorldPosition(v);
        if (isNaN(v.x) || isNaN(v.y) || isNaN(v.z)) {
            console.error("Root position is NaN");
            return new THREE.Vector3(0, 0, 0);
        }
        return v;
    }

    /**
     * Apply a frame from G1Animation to the robot joints
     * 
     * Mapping between FBX and CSV:
     * - FBX root: "_floating_base_joint" -> CSV: "root_translateX/Y/Z", "root_rotateX/Y/Z"
     * - FBX joints: "_left_hip_pitch_joint" -> CSV: "left_hip_pitch_joint_dof" (strip leading _, add _dof)
     */
    setFrame(frame: number) {
        if (!this.anim) return;
        
        try {
            const frameData = this.anim.getFrameData(frame);
            if (!frameData) return;
            
        // Apply root transform to floating_base_joint
        const root = this.joints.get('floating_base_joint');
        if (root) {
            // CSV is in Z-up local space (cm), FBX is in Z-up local space (meters)
            // The parent object rotation handles Z-up -> Y-up for rendering
            const posScale = 0.01;
            root.position.set(
                (frameData.root_translateX ?? 0) * posScale,
                (frameData.root_translateY ?? 0) * posScale,
                (frameData.root_translateZ ?? 0) * posScale
            );
            
            // Rotation values from CSV root_rotate* columns (in degrees).
            // CSV is in Z-up space.  The Euler order must match the
            // convention used when the CSV was exported.  For URDF/physics
            // robots this is typically intrinsic ZYX (extrinsic XYZ).
            // Three.js Euler 'ZYX' applies Z first, then Y, then X —
            // which matches the standard robotics convention.
            const rx = THREE.MathUtils.degToRad(frameData.root_rotateX ?? 0);
            const ry = THREE.MathUtils.degToRad(frameData.root_rotateY ?? 0);
            const rz = THREE.MathUtils.degToRad(frameData.root_rotateZ ?? 0);
            root.rotation.set(rx, ry, rz, 'ZYX');
        }

        // Apply joint DOFs (degrees of freedom)
        // Each joint is a single-DOF revolute joint. The CSV angle is
        // composed with the FBX rest quaternion (URDF link-frame transform).
        // In the Z-up FBX model:
        //   pitch = rotation around Y axis (sagittal plane)
        //   roll  = rotation around X axis (along limb)
        //   yaw   = rotation around Z axis (vertical)
        // knee/elbow joints are pitch joints
        const _dofQuat = new THREE.Quaternion();
        const _axis = new THREE.Vector3();
        for (const [jointName, joint] of this.joints) {
            if (jointName === 'floating_base_joint') continue;
            
            const dofKey = jointName + '_dof';
            const angle = frameData[dofKey];
            
            if (angle !== undefined) {
                const radAngle = THREE.MathUtils.degToRad(angle);
                
                if (jointName.includes('pitch') || jointName.includes('knee') || jointName.includes('elbow')) {
                    _axis.set(0, 1, 0);
                } else if (jointName.includes('roll')) {
                    _axis.set(1, 0, 0);
                } else if (jointName.includes('yaw')) {
                    _axis.set(0, 0, 1);
                } else {
                    _axis.set(0, 1, 0);
                }
                
                const restQ = this.restQuaternions.get(jointName);
                if (restQ) {
                    _dofQuat.setFromAxisAngle(_axis, radAngle);
                    joint.quaternion.copy(restQ).multiply(_dofQuat);
                } else {
                    _dofQuat.setFromAxisAngle(_axis, radAngle);
                    joint.quaternion.copy(_dofQuat);
                }
            }
        }
        
        } catch (error) {
            console.error('[G1 setFrame] ERROR:', error);
        }
    }

    dispose() {
        // Remove and dispose skeleton helper from scene
        if (this.skeletonHelper) {
            if (this.skeletonHelper.parent) {
                this.skeletonHelper.parent.remove(this.skeletonHelper);
            }
            if (this.skeletonHelper.dispose) {
                this.skeletonHelper.dispose();
            }
            this.skeletonHelper = null;
        }
        // Dispose geometries and materials
        this.object.traverse((child) => {
            if ((child as any).geometry) {
                (child as any).geometry.dispose();
            }
            if ((child as any).material) {
                const mat = (child as any).material;
                if (Array.isArray(mat)) {
                    mat.forEach(m => m.dispose());
                } else {
                    mat.dispose();
                }
            }
        });
        this.joints.clear();
    }
}
