"""Per-request citation ledger for the advisor.

Every row shown to the model — from the standing gather phase and from tool
results — is stamped with a stable `cite` id as it is built. The model can
then reference `[S3]` inline in its answer; `cited()` resolves only the ids
that actually appear, so retrieved-but-unused sources never reach the client.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Sequence
from typing import Any

_CITE_PATTERN = re.compile(r"\[S(\d+)\]")

_REFERENCE_FALLBACKS = (
    "reference", "published_at", "valid_from", "reported_at", "available_at",
)


class CitationLedger:
    """Assigns stable ids to retrieved rows and resolves links per kind."""

    def __init__(self) -> None:
        self._next_id = 1
        self._citations: dict[str, dict[str, Any]] = {}

    def attach(
        self,
        rows: Sequence[dict[str, Any]],
        *,
        kind: str,
        title_key: str,
        source_key: str | None = None,
        url_key: str | None = None,
        reference_key: str | None = None,
        href: Callable[[dict[str, Any]], str] | str | None = None,
    ) -> Sequence[dict[str, Any]]:
        """Stamp each row with a `cite` id and record its resolved citation."""
        for row in rows:
            reference = row.get(reference_key) if reference_key else None
            if reference is None:
                for candidate in _REFERENCE_FALLBACKS:
                    if row.get(candidate) is not None:
                        reference = row[candidate]
                        break
            entry: dict[str, Any] = {
                "id": self._new_id(),
                "kind": kind,
                "title": str(row.get(title_key) or kind),
                "source": row.get(source_key) if source_key else None,
                "reference": reference,
            }
            if url_key and row.get(url_key):
                entry["url"] = row[url_key]
            elif href is not None:
                entry["href"] = href(row) if callable(href) else href
            if "similarity" in row:
                entry["similarity"] = row["similarity"]
            self._citations[entry["id"]] = entry
            row["cite"] = entry["id"]
        return rows

    def attach_corpus(
        self, conn: Any, hits: Sequence[dict[str, Any]]
    ) -> Sequence[dict[str, Any]]:
        """`search_corpus` hits: resolve an external url for news/hazard kinds,
        an in-app zone link for field_report/zone_dossier kinds, by two batch
        lookups keyed on the ids the embedding pipeline stamped as `source_id`."""
        news_ids = [h["source_id"] for h in hits if h.get("kind") == "news"]
        hazard_ids = [h["source_id"] for h in hits if h.get("kind") == "hazard"]
        urls: dict[str, str] = {}
        if news_ids or hazard_ids:
            with conn.cursor() as cur:
                if news_ids:
                    cur.execute(
                        "SELECT id, url FROM news_documents WHERE id = ANY(%s)",
                        (news_ids,),
                    )
                    urls.update(
                        {str(r["id"]): r["url"] for r in cur.fetchall() if r["url"]}
                    )
                if hazard_ids:
                    cur.execute(
                        "SELECT id, url FROM hazard_bulletins WHERE id = ANY(%s)",
                        (hazard_ids,),
                    )
                    urls.update(
                        {str(r["id"]): r["url"] for r in cur.fetchall() if r["url"]}
                    )
        for hit in hits:
            content = str(hit.get("content") or "")
            title = content.splitlines()[0][:160] if content else str(hit.get("kind"))
            entry: dict[str, Any] = {
                "id": self._new_id(),
                "kind": hit.get("kind"),
                "title": title,
                "source": hit.get("source_id"),
                "reference": hit.get("available_at"),
            }
            if "similarity" in hit:
                entry["similarity"] = hit["similarity"]
            url = urls.get(str(hit.get("source_id")))
            if url:
                entry["url"] = url
            elif hit.get("zone_id"):
                entry["href"] = f"/zones/{hit['zone_id']}"
            self._citations[entry["id"]] = entry
            hit["cite"] = entry["id"]
        return hits

    def cited(self, answer: str) -> list[dict[str, Any]]:
        """Only the citations whose `[S<n>]` marker actually appears in `answer`,
        in first-mention order, deduplicated."""
        seen: set[str] = set()
        out: list[dict[str, Any]] = []
        for match in _CITE_PATTERN.finditer(answer):
            cite_id = f"S{match.group(1)}"
            if cite_id in seen:
                continue
            seen.add(cite_id)
            citation = self._citations.get(cite_id)
            if citation is not None:
                out.append(citation)
        return out

    def _new_id(self) -> str:
        cite_id = f"S{self._next_id}"
        self._next_id += 1
        return cite_id
