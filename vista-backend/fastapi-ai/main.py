from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging

from routers import sentiment, prediction, risk, dashboard
from services.db import init_db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("vista-ai")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    logger.info("🤖 VISTA AI Service starting up...")
    await init_db()
    yield
    logger.info("VISTA AI Service shutting down.")


app = FastAPI(
    title="VISTA AI Microservice",
    description="AI engine for student monitoring — predictions, risk, and sentiment",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Routers ──────────────────────────────────────────────────
app.include_router(sentiment.router, prefix="/analyze", tags=["Sentiment"])
app.include_router(prediction.router, prefix="/predict", tags=["Prediction"])
app.include_router(risk.router, prefix="/classify", tags=["Risk"])
app.include_router(dashboard.router, prefix="/dashboard", tags=["Dashboard"])


@app.get("/health")
async def health():
    return {"status": "OK", "service": "VISTA AI Microservice"}