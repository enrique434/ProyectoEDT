"""ASGI entry point: ``uvicorn app.asgi:app --reload``."""
from app.main import create_app

app = create_app()
