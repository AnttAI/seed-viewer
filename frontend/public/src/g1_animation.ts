import { g } from './globals.ts';
import { setAnimToDownload } from './download_anim.ts';
import { fillTwoColumnMetadata } from './metadata_viewer.ts';
import { Model3DG1 } from './models.ts';

/**
 * G1Animation - Animation data parsed from CSV for the G1 robot
 * CSV format has columns like: Frame, root_translateX/Y/Z, root_rotateX/Y/Z, joint_dof values
 */
export class G1Animation {
    frameCount: number;
    fps: number = 120; // Default FPS for G1 animations
    maxFrame: number;
    name: string;
    csvContent: string;
    
    // Column names from CSV header
    private columns: string[] = [];
    // Frame data: array of objects with column values
    private frames: { [key: string]: number }[] = [];

    constructor(csvContent: string, name: string) {
        this.name = name;
        this.csvContent = csvContent;
        this.parseCSV(csvContent);
        this.frameCount = this.frames.length;
        this.maxFrame = this.frameCount - 1;
    }

    private parseCSV(csvContent: string) {
        const lines = csvContent.trim().split('\n');
        if (lines.length < 2) {
            throw new Error('CSV must have at least header and one data row');
        }

        // Parse header
        this.columns = lines[0].split(',').map(col => col.trim());

        // Parse data rows
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => parseFloat(v.trim()));
            const frameData: { [key: string]: number } = {};
            
            for (let j = 0; j < this.columns.length; j++) {
                frameData[this.columns[j]] = values[j] || 0;
            }
            
            this.frames.push(frameData);
        }

        console.log(`G1Animation loaded: ${this.frames.length} frames, columns:`, this.columns);
    }

    /**
     * Get interpolated frame data for a given frame number
     * Frame can be fractional for smooth interpolation
     */
    getFrameData(frame: number): { [key: string]: number } | null {
        if (this.frames.length === 0) return null;

        // Clamp frame to valid range
        frame = Math.max(0, Math.min(frame, this.maxFrame));

        const frameFloor = Math.floor(frame);
        const frameCeil = Math.min(Math.ceil(frame), this.maxFrame);
        const t = frame - frameFloor;

        // If we're exactly on a frame or at the end, return that frame
        if (t === 0 || frameFloor === frameCeil) {
            return { ...this.frames[frameFloor] };
        }

        // Interpolate between frames
        const frame1 = this.frames[frameFloor];
        const frame2 = this.frames[frameCeil];
        const result: { [key: string]: number } = {};

        for (const col of this.columns) {
            result[col] = frame1[col] * (1 - t) + frame2[col] * t;
        }

        return result;
    }

    /**
     * Get the column names (useful for debugging)
     */
    getColumns(): string[] {
        return [...this.columns];
    }
}


/**
 * Load G1 animation from CSV content string
 */
export async function loadG1CSVString(
    csvContent: string, 
    name: string = "no_name", 
    fromBrowser: boolean = true, 
    metadata: { [key: string]: string } | null = null
) {
    console.log('[G1 Animation] loadG1CSVString called with name:', name);
    
    try {
        name = name.replace(".csv", "");
        
        const anim = new G1Animation(csvContent, name);
        console.log('[G1 Animation] Animation created, frameCount:', anim.frameCount);
        
        // Check if MODEL3D exists and is a G1 model
        if (!g.MODEL3D) {
            console.error('[G1 Animation] ERROR: g.MODEL3D is null/undefined');
            throw new Error('MODEL3D not initialized');
        }
        
        // Assign to the G1 model
        const model = g.MODEL3D as Model3DG1;
        if (!model.joints) {
            console.error('[G1 Animation] ERROR: model.joints is undefined');
            throw new Error('Model joints not initialized');
        }
        
        console.log('[G1 Animation] Assigning animation to model with joints:', Array.from(model.joints.keys()));
        model.anim = anim;

    // Handle metadata display
    if (!metadata) {
        g.SPINNER.show("Fetching metadata");
        fetch(`${g.BACKEND_URL}/metadata/${name}`)
            .then((res) => {
                if (!res.ok) {
                    console.log("Failed to fetch metadata");
                    return null;
                }
                return res.json();
            })
            .then((data) => {
                if (data) {
                    fillTwoColumnMetadata(data);
                } else {
                    fillTwoColumnMetadata({ 
                        "Name": name, 
                        "Frames": anim.maxFrame.toString(), 
                        "FPS": anim.fps.toString() 
                    }, false);
                }
            })
            .catch(err => {
                console.log(err);
                return null;
            })
            .finally(() => {
                g.SPINNER.hide("Fetching metadata");
            });
    } else {
        fillTwoColumnMetadata(metadata);
    }

    // Update global animation state
    g.FRAME = 0;
    g.FILENAME = name;
    g.LOOP_START = 0;
    g.LOOP_END = anim.maxFrame;

    // Set animation for download (as CSV)
    const csvBlob = new Blob([csvContent], { type: 'text/csv' });
    const csvUrl = URL.createObjectURL(csvBlob);
    setAnimToDownload(csvUrl, name + '.csv');
    
    console.log('[G1 Animation] Animation loaded successfully, maxFrame:', anim.maxFrame);
    
    } catch (error) {
        console.error('[G1 Animation] ERROR in loadG1CSVString:', error);
        throw error;
    }
}
