"""RNF-01: the domain layer must not depend on frameworks or outer layers."""
import ast
from pathlib import Path

DOMAIN = Path(__file__).resolve().parents[1] / "app" / "domain"
FORBIDDEN = ("fastapi", "sqlalchemy", "pydantic", "alembic", "app.application", "app.infrastructure", "app.api")


def test_domain_has_no_outer_dependencies():
    offenders = []
    for path in DOMAIN.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            names = [a.name for a in node.names] if isinstance(node, ast.Import) else \
                [node.module or ""] if isinstance(node, ast.ImportFrom) else []
            offenders += [f"{path.name}: {n}" for n in names if n.startswith(FORBIDDEN)]
    assert offenders == []
