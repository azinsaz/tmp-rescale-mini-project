"""Sortable cursor pagination for the jobs list endpoint.

Ninja's built-in :class:`CursorPagination` enforces a static ordering set at
decoration time (see ``docs/specs/backend/design.md`` ADR-4). This subclass
adds a ``sort`` query parameter validated against a closed allow-list and
re-derives the ordering tuple per request without mutating shared instance
state — important because the paginator object is shared across async
requests.

The cursor stays opaque to clients; it just encodes the position value of
the *current* sort field plus an offset. Switching sort mid-pagination
invalidates the cursor (the FE drops the cursor on sort change anyway).
"""

from typing import Any, Optional

from django.db.models import QuerySet
from django.http import HttpRequest
from ninja.pagination import CursorPagination


class SortableCursorPagination(CursorPagination):
    """Cursor paginator that accepts a per-request ``sort`` parameter.

    Args:
        allowed_sorts: tuple of permitted sort tokens (e.g. ``("name", "-name")``).
            Anything else falls back to ``default_sort``.
        default_sort: token used when ``sort`` is missing or invalid.

    The first ordering field is dynamic; ``id`` is appended as a stable
    tiebreaker, matching direction (descending sort → ``-id``).
    """

    class Input(CursorPagination.Input):
        sort: str | None = None

    def __init__(
        self,
        *,
        allowed_sorts: tuple[str, ...],
        default_sort: str,
        **kwargs: Any,
    ) -> None:
        self._allowed_sorts = set(allowed_sorts)
        self._default_sort = default_sort
        # Seed the parent with the default ordering so any code path that
        # reads self.ordering during init has a sane value. Per-request
        # overrides happen in apaginate_queryset, scoped to local vars.
        super().__init__(ordering=self._make_ordering(default_sort), **kwargs)

    @staticmethod
    def _make_ordering(sort: str) -> tuple[str, ...]:
        descending = sort.startswith("-")
        return (sort, "-id" if descending else "id")

    def _resolve_sort(self, raw: str | None) -> str:
        if raw and raw in self._allowed_sorts:
            return raw
        return self._default_sort

    async def apaginate_queryset(  # type: ignore[override]
        self,
        queryset: QuerySet,
        pagination: "SortableCursorPagination.Input",
        request: HttpRequest,
        **params: Any,
    ) -> Any:
        # Per-request ordering. Local vars only — never mutate self.
        sort = self._resolve_sort(pagination.sort)
        ordering = self._make_ordering(sort)
        order_attr = ordering[0][1:] if ordering[0].startswith("-") else ordering[0]
        order_attr_reversed = ordering[0].startswith("-")

        page_size = self._get_page_size(pagination.page_size)
        cursor = self.Cursor.from_encoded_param(pagination.cursor)

        # Apply ordering (flipped on backward pagination) and cursor position.
        active_ordering = self._reverse_order(ordering) if cursor.r else ordering
        queryset = queryset.order_by(*active_ordering)
        if cursor.p is not None:
            cmp = "gte" if cursor.r == order_attr_reversed else "lte"
            queryset = queryset.filter(**{f"{order_attr}__{cmp}": cursor.p})

        results_plus_one = [obj async for obj in queryset[cursor.o : cursor.o + page_size + 1]]

        def position(item: Any) -> str:
            return str(getattr(item, order_attr))

        additional_position = (
            position(results_plus_one[-1]) if len(results_plus_one) > page_size else None
        )

        if cursor.r:
            results = list(reversed(results_plus_one[:page_size]))
        else:
            results = results_plus_one[:page_size]

        # The parent's cursor builders read self._get_position → self._order_attribute,
        # so build cursors locally to keep ordering scoped to this request.
        next_cursor = self._build_next_cursor_local(cursor, results, additional_position, position)
        previous_cursor = self._build_previous_cursor_local(
            cursor, results, additional_position, position
        )

        base_url = request.build_absolute_uri()
        return {
            "next": self._add_cursor_to_URL(base_url, next_cursor),
            "previous": self._add_cursor_to_URL(base_url, previous_cursor),
            self.items_attribute: results,
        }

    def _build_next_cursor_local(
        self,
        current: "CursorPagination.Cursor",
        results: list[Any],
        additional_position: str | None,
        position: Any,
    ) -> Optional["CursorPagination.Cursor"]:
        if (additional_position is None and not current.r) or not results:
            return None
        if not current.r:
            next_position = additional_position
        else:
            next_position = position(results[-1])
        offset = 0
        if current.p == next_position and not current.r:
            offset += current.o + len(results)
        else:
            for item in reversed(results):
                if position(item) != next_position:
                    break
                offset += 1
        return self.Cursor(o=offset, r=False, p=next_position)

    def _build_previous_cursor_local(
        self,
        current: "CursorPagination.Cursor",
        results: list[Any],
        additional_position: str | None,
        position: Any,
    ) -> Optional["CursorPagination.Cursor"]:
        if (current.r and additional_position is None) or current.p is None:
            return None
        if not results:
            return self.Cursor(o=0, r=True, p=current.p)
        if current.r:
            previous_position = additional_position
        else:
            previous_position = position(results[0])
        offset = 0
        if current.p == previous_position and current.r:
            offset += current.o + len(results)
        else:
            for item in results:
                if position(item) != previous_position:
                    break
                offset += 1
        return self.Cursor(o=offset, r=True, p=previous_position)
