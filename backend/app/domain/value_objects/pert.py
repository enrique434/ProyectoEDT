"""PERT three-point estimate (RF-25, RN-17)."""
from __future__ import annotations

from dataclasses import dataclass

from app.domain.errors import ValidationError


@dataclass(frozen=True)
class PertEstimate:
    """Optimistic, most likely and pessimistic durations expressed in the same unit."""

    optimistic: float
    most_likely: float
    pessimistic: float

    def __post_init__(self) -> None:
        if min(self.optimistic, self.most_likely, self.pessimistic) < 0:
            raise ValidationError("Las estimaciones PERT no pueden ser negativas")
        if not self.optimistic <= self.most_likely <= self.pessimistic:
            raise ValidationError("PERT requiere Optimista ≤ Más probable ≤ Pesimista")

    @property
    def expected(self) -> float:
        """TE = (O + 4M + P) / 6"""
        return (self.optimistic + 4 * self.most_likely + self.pessimistic) / 6

    @property
    def standard_deviation(self) -> float:
        """σ = (P − O) / 6"""
        return (self.pessimistic - self.optimistic) / 6

    @property
    def variance(self) -> float:
        return self.standard_deviation ** 2
