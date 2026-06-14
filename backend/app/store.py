"""In-memory store of precomputed pipeline artifacts, loaded once at startup.

If artifacts are missing, the pipeline is run automatically to generate them.
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

ARTIFACTS = Path(__file__).resolve().parents[1] / "artifacts"
LLM_CACHE_FILE = ARTIFACTS / "llm_narratives.json"


class Store:
    def __init__(self):
        self.alerts: list[dict] = []
        self.metrics: dict = {}
        self.stats: dict = {}
        self.users: list[dict] = []
        self.predictions: pd.DataFrame = pd.DataFrame()
        self._alerts_by_id: dict[str, dict] = {}
        self._users_by_id: dict[str, dict] = {}
        self._llm_cache: dict[str, dict] = {}

    def load(self):
        if not (ARTIFACTS / "alerts.json").exists():
            from .pipeline import run
            run(write=True)
        self.alerts = json.loads((ARTIFACTS / "alerts.json").read_text())
        self.metrics = json.loads((ARTIFACTS / "metrics.json").read_text())
        self.stats = json.loads((ARTIFACTS / "stats.json").read_text())
        self.users = json.loads((ARTIFACTS / "users.json").read_text())
        self.predictions = pd.read_csv(ARTIFACTS / "predictions.csv").fillna("")
        self._alerts_by_id = {a["access_id"]: a for a in self.alerts}
        self._users_by_id = {u["user_id"]: u for u in self.users}
        if LLM_CACHE_FILE.exists():
            self._llm_cache = json.loads(LLM_CACHE_FILE.read_text())
        else:
            self._llm_cache = {}
        return self

    def alert(self, access_id: str) -> dict | None:
        a = self._alerts_by_id.get(access_id)
        if a is None:
            return None
        llm = self._llm_cache.get(access_id)
        if llm:
            return {**a, "llm": llm}
        return a

    def user(self, user_id: str) -> dict | None:
        return self._users_by_id.get(user_id)

    def user_events(self, user_id: str) -> list[dict]:
        df = self.predictions[self.predictions["user_id"] == user_id].copy()
        df = df.sort_values("risk_score", ascending=False)
        return df.to_dict(orient="records")

    def get_llm(self, access_id: str) -> dict | None:
        return self._llm_cache.get(access_id)

    def set_llm(self, access_id: str, payload: dict) -> None:
        self._llm_cache[access_id] = payload
        ARTIFACTS.mkdir(exist_ok=True)
        LLM_CACHE_FILE.write_text(json.dumps(self._llm_cache, indent=2))


store = Store()
