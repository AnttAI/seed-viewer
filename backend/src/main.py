from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
import os
from loguru import logger
from contextlib import asynccontextmanager

from storage_local.main import router as storage_local_router
from metadata.main import router as metadata_router
from robot_t2 import router as robot_t2_router

from globals import Global


class SharedArrayBufferMiddleware(BaseHTTPMiddleware):
    """Add headers required for SharedArrayBuffer (needed for USD loader WASM)"""
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        return response


@asynccontextmanager
async def lifespan(app: FastAPI):   
    Global.initialize()
     
    yield
    Global.deinitialize()
    logger.info("Server shutting down...")


if Global.openapi_disable:
    openapi = {}
else:
    openapi = {
        "docs_url":None, 
        "redoc_url":None, 
        "openapi_url":None
    } 

app = FastAPI(lifespan=lifespan, **openapi, debug=True)

# Add SharedArrayBuffer headers for WASM support
app.add_middleware(SharedArrayBufferMiddleware)

api_app = FastAPI(**openapi, debug=True)
api_app.include_router(storage_local_router, prefix="/storage_local")
api_app.include_router(metadata_router, prefix="/metadata")
api_app.include_router(robot_t2_router, prefix="/robot/t2")
app.mount('/api', api_app)


if os.path.isdir("dist"):
    app.mount("/", StaticFiles(directory="dist", html=True, check_dir=True))



# cors allow localhost:5173 (Vite dev server)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["http://localhost:5173", "*"],
)


if __name__ == "__main__":
    import uvicorn
    
    assert os.environ.get("PORT") is not None, "PORT env var not set"
    
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT")),

    )
