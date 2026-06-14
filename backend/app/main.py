"""FastAPI app for PS4 — Data Access Audit & Insider Threat Detection.

Run:  uvicorn app.main:app --reload   (from backend/)
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes import router
from .store import store


@asynccontextmanager
async def lifespan(app: FastAPI):
    store.load()
    yield


app = FastAPI(
    title="PS4 — Insider Threat Detection API",
    description="Risk-scored data-access alerts with explanations and evaluation.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # dev: Vite serves on :5173
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


@app.get("/")
def health():
    return {"status": "ok", "service": "ps4-insider-threat", "docs": "/docs"}
