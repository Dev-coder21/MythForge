"""Shared HTTP client for Wikimedia APIs (identifying User-Agent, sane timeouts)."""

import httpx

from app.core.config import get_settings


class RetrievalConfigError(Exception):
    """Retrieval cannot run until the Wikimedia contact is configured."""


def make_client(transport: httpx.BaseTransport | None = None) -> httpx.Client:
    """Tests pass an httpx.MockTransport; production uses the network."""
    s = get_settings()
    if not s.http_contact and transport is None:
        raise RetrievalConfigError(
            "Set HTTP_CONTACT in backend/.env to an email address or URL. Wikimedia requires it in the "
            "User-Agent and refuses anonymous requests (https://w.wiki/4wJS)."
        )
    return httpx.Client(
        headers={"User-Agent": s.http_user_agent, "Accept": "application/json"},
        timeout=httpx.Timeout(20.0, connect=10.0),
        follow_redirects=True,
        transport=transport,
    )
