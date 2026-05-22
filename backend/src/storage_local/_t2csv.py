from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from globals import Global

router = APIRouter()


@router.get("/")
def t2csv(csvpath: str = None, random: bool = False):
    """Serve T2 robot animation CSV files."""

    assert csvpath is not None or random is not None, "Either csvpath or random must be provided."

    if random:
        move = Global.metadata.sample(n=1)
        filename = move.index[0]
        move = move.iloc[0].to_dict()
        move["filename"] = filename
    else:
        if csvpath not in Global.metadata.index:
            return JSONResponse(
                status_code=404, content={"error": f"move '{csvpath}' not found in metadata."}
            )
        move = Global.metadata.loc[csvpath].to_dict()
        move["filename"] = csvpath

    path = move.get("move_t2_path")
    if not path or (isinstance(path, float) and path != path):
        path = f"t2_csv/{move['filename']}.csv"

    content = Global.read_file(path)
    if content is None:
        return JSONResponse(
            status_code=404, content={"error": f"T2 CSV file not found: {path}"}
        )

    return {
        "name": Path(path).stem,
        "csv": content,
    }
