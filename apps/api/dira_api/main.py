"""FastAPI app shell — routes, webhooks, SSE. Keep thin; logic lives in packages."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Dira API",
    description="Causal situation room for the Horn of Africa",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "dira-api"}


def run() -> None:
    import uvicorn

    uvicorn.run("dira_api.main:app", host="0.0.0.0", port=8000, reload=True)


if __name__ == "__main__":
    run()
