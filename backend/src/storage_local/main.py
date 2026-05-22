from loguru import logger

logger.debug("Loading storage_local router...")

from fastapi import APIRouter

router = APIRouter()




# import the other routers
from . import _metadata, _g1csv, _t2csv, _somabvh, _temporal_labels

router.include_router(_metadata.router, prefix="/metadata")
router.include_router(_g1csv.router, prefix="/g1csv")
router.include_router(_t2csv.router, prefix="/t2csv")
router.include_router(_somabvh.router, prefix="/somabvh")
router.include_router(_temporal_labels.router, prefix="/temporal_labels")
