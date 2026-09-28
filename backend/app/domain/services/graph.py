"""Directed-graph utilities: topological order and cycle detection (RF-23, RN-12)."""
from __future__ import annotations

from collections import deque
from typing import Dict, Hashable, Iterable, List, Sequence, Tuple, TypeVar

from app.domain.errors import CycleError

N = TypeVar("N", bound=Hashable)


def topological_order(nodes: Sequence[N], edges: Iterable[Tuple[N, N]]) -> List[N]:
    """Kahn's algorithm. Raises ``CycleError`` with one concrete cycle if the graph is not a DAG."""
    successors: Dict[N, List[N]] = {node: [] for node in nodes}
    in_degree: Dict[N, int] = {node: 0 for node in nodes}
    for source, target in edges:
        successors[source].append(target)
        in_degree[target] += 1

    queue = deque(node for node in nodes if in_degree[node] == 0)
    order: List[N] = []
    while queue:
        node = queue.popleft()
        order.append(node)
        for target in successors[node]:
            in_degree[target] -= 1
            if in_degree[target] == 0:
                queue.append(target)

    if len(order) != len(nodes):
        remaining = {node for node in nodes if in_degree[node] > 0}
        cycle = _find_cycle(remaining, successors)
        raise CycleError("La red de actividades contiene una dependencia circular", cycle)
    return order


def _find_cycle(candidates: set, successors: Dict[N, List[N]]) -> List[N]:
    """Iterative DFS restricted to the nodes Kahn could not order. Returns [a, b, ..., a]."""
    visited: set = set()
    for root in candidates:
        if root in visited:
            continue
        path: List[N] = []
        on_path: Dict[N, int] = {}
        stack = [(root, iter(successors[root]))]
        path.append(root)
        on_path[root] = 0
        visited.add(root)
        while stack:
            node, children = stack[-1]
            advanced = False
            for child in children:
                if child not in candidates:
                    continue
                if child in on_path:
                    return path[on_path[child]:] + [child]
                if child not in visited:
                    visited.add(child)
                    on_path[child] = len(path)
                    path.append(child)
                    stack.append((child, iter(successors[child])))
                    advanced = True
                    break
            if not advanced:
                stack.pop()
                on_path.pop(path.pop())
    return []  # pragma: no cover - unreachable when candidates contain a cycle
