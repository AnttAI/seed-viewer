"""
Generates a metadata.parquet for seed-viewer from soma-retargeter BVH/CSV files.

Run from anywhere:
    python generate_metadata.py

Sets up DATA_ROOT at:
    /home/jony/Downloads/soma-retargeter/assets/motions/
"""

import os
import pandas as pd
from pathlib import Path

MOTIONS_DIR = Path("/home/jony/Downloads/soma-retargeter/assets/motions")
BVH_DIR = MOTIONS_DIR / "bvh"
CSV_DIR = MOTIONS_DIR / "csv"
T2_CSV_DIR = MOTIONS_DIR / "t2_csv"
METADATA_DIR = MOTIONS_DIR / "metadata"
FILES_DIR = MOTIONS_DIR / "files"
BVH_SUBDIR = os.environ.get("BVH_SUBDIR", "").strip("/")
CSV_SUBDIR = os.environ.get("CSV_SUBDIR", "").strip("/")
T2_CSV_SUBDIR = os.environ.get("T2_CSV_SUBDIR", "").strip("/")
BVH_SUBDIRS = os.environ.get("BVH_SUBDIRS", BVH_SUBDIR)
CSV_SUBDIRS = os.environ.get("CSV_SUBDIRS", CSV_SUBDIR)
T2_CSV_SUBDIRS = os.environ.get("T2_CSV_SUBDIRS", T2_CSV_SUBDIR)

def parse_subdirs(value: str) -> list[str]:
    return [part.strip().strip("/") for part in value.split(",") if part.strip().strip("/")]

def scan_roots(base_dir: Path, subdirs: str) -> list[Path]:
    parsed = parse_subdirs(subdirs)
    return [base_dir / subdir for subdir in parsed] if parsed else [base_dir]

def describe_scan_roots(base_dir: Path, subdirs: str) -> str:
    return ", ".join(str(path) for path in scan_roots(base_dir, subdirs))

def collect_bvh_files():
    """Collect all BVH files, returning {stem: relative_path_from_bvh_dir}."""
    result = {}
    for root in scan_roots(BVH_DIR, BVH_SUBDIRS):
        for path in root.rglob("*.bvh"):
            rel = path.relative_to(BVH_DIR)
            stem = path.stem
            result[stem] = str(rel)
    return result

def collect_csv_files():
    """Collect all CSV files, returning {stem: relative_path_from_csv_dir}."""
    result = {}
    for root in scan_roots(CSV_DIR, CSV_SUBDIRS):
        for path in root.rglob("*.csv"):
            rel = path.relative_to(CSV_DIR)
            stem = path.stem
            result[stem] = str(rel)
    return result

def collect_t2_csv_files():
    """Collect all T2 CSV files, returning {stem: relative_path_from_t2_csv_dir}."""
    result = {}
    for root in scan_roots(T2_CSV_DIR, T2_CSV_SUBDIRS):
        for path in root.rglob("*.csv"):
            rel = path.relative_to(T2_CSV_DIR)
            stem = path.stem
            result[stem] = str(rel)
    return result

def make_move_name(stem: str) -> str:
    """Turn a filename stem into a human-readable display name."""
    name = stem.replace("_", " ").replace("--", " ").strip()
    # Remove trailing __AXXX codes like __A508
    import re
    name = re.sub(r'\s*__A\d+\s*$', '', name)
    name = re.sub(r'\s+', ' ', name)
    return name.strip().title()

def main():
    print(f"Scanning BVH files in: {describe_scan_roots(BVH_DIR, BVH_SUBDIRS)}")
    bvh_files = collect_bvh_files()
    print(f"  Found {len(bvh_files)} BVH files")

    print(f"Scanning CSV files in: {describe_scan_roots(CSV_DIR, CSV_SUBDIRS)}")
    csv_files = collect_csv_files()
    print(f"  Found {len(csv_files)} CSV files")

    print(f"Scanning T2 CSV files in: {describe_scan_roots(T2_CSV_DIR, T2_CSV_SUBDIRS)}")
    t2_csv_files = collect_t2_csv_files()
    print(f"  Found {len(t2_csv_files)} T2 CSV files")

    # Union of all stems
    all_stems = sorted(set(bvh_files) | set(csv_files) | set(t2_csv_files))
    print(f"Total unique animations: {len(all_stems)}")

    rows = []
    for stem in all_stems:
        bvh_rel = bvh_files.get(stem)
        csv_rel = csv_files.get(stem)
        t2_csv_rel = t2_csv_files.get(stem)
        rows.append({
            "filename": stem,
            "move_name": make_move_name(stem),
            "move_soma_uniform_path": f"bvh/{bvh_rel}" if bvh_rel else None,
            "move_g1_path": f"csv/{csv_rel}" if csv_rel else None,
            "move_t2_path": f"t2_csv/{t2_csv_rel}" if t2_csv_rel else None,
        })

    df = pd.DataFrame(rows)

    # Write parquet
    METADATA_DIR.mkdir(parents=True, exist_ok=True)
    out_path = METADATA_DIR / "metadata.parquet"
    df.to_parquet(out_path)
    print(f"\nWrote: {out_path}  ({len(df)} rows)")

    # Set up files/ symlinks pointing to bvh/ and csv directories.
    FILES_DIR.mkdir(exist_ok=True)
    for name, target in [("bvh", BVH_DIR), ("csv", CSV_DIR), ("t2_csv", T2_CSV_DIR)]:
        link = FILES_DIR / name
        if link.is_symlink():
            link.unlink()
        if not link.exists():
            link.symlink_to(target)
            print(f"Created symlink: {link} -> {target}")
        else:
            print(f"Already exists (skipped): {link}")

    print(f"\nDone! Run the backend with:")
    print(f"  DATA_ROOT={MOTIONS_DIR} PORT=8080 python src/main.py")

if __name__ == "__main__":
    main()
