"""
Free LLM providers behind one interface, called over plain HTTP (no SDKs):
- Gemini (Google AI Studio free tier), JSON output mode
- Groq (free tier), OpenAI-compatible JSON mode
- Ollama (local, optional)
A FallbackChain tries them in order, backing off on rate limits first.
"""

from __future__ import annotations

import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Protocol

import httpx

from app.core.config import Settings


class LLMError(Exception):
    """A provider failed (bad response, server error, misconfiguration)."""


class RateLimitError(LLMError):
    def __init__(self, message: str, retry_after: float | None = None):
        super().__init__(message)
        self.retry_after = retry_after


class AllProvidersFailed(LLMError):
    """Every configured provider failed; the message says why, per provider."""


Message = dict  # {"role": "user" | "assistant", "content": str}


class LLMProvider(Protocol):
    name: str

    def complete_json(self, system: str, messages: list[Message], max_tokens: int) -> str: ...


def _retry_after(response: httpx.Response) -> float | None:
    header = response.headers.get("retry-after")
    if header:
        try:
            return float(header)
        except ValueError:
            pass
    # Gemini puts it in the body: {"details": [{"retryDelay": "31s"}]}
    m = re.search(r'"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"', response.text)
    return float(m.group(1)) if m else None


def _check(response: httpx.Response, provider: str) -> None:
    if response.status_code == 429:
        raise RateLimitError(f"{provider}: rate limited (free-tier quota reached)", _retry_after(response))
    if response.status_code >= 400:
        raise LLMError(f"{provider}: HTTP {response.status_code}: {response.text[:300]}")


@dataclass
class GeminiProvider:
    api_key: str
    model: str
    client: httpx.Client
    name: str = "gemini"

    def complete_json(self, system: str, messages: list[Message], max_tokens: int) -> str:
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [
                {"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]} for m in messages
            ],
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": 0.8,
                "maxOutputTokens": max_tokens,
                # Thinking tokens count against the free quota and aren't needed for this task.
                "thinkingConfig": {"thinkingBudget": 0},
            },
        }
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        r = self.client.post(url, json=body, headers={"x-goog-api-key": self.api_key})
        if r.status_code == 400 and "thinking" in r.text.lower():
            body["generationConfig"].pop("thinkingConfig")  # model without a thinking budget setting
            r = self.client.post(url, json=body, headers={"x-goog-api-key": self.api_key})
        _check(r, "Gemini")
        data = r.json()
        try:
            parts = data["candidates"][0]["content"]["parts"]
        except (KeyError, IndexError) as e:
            reason = data.get("promptFeedback", {}).get("blockReason") or data.get("candidates", [{}])[0].get("finishReason")
            raise LLMError(f"Gemini: no content returned ({reason or e})") from e
        return "".join(p.get("text", "") for p in parts)


@dataclass
class GroqProvider:
    api_key: str
    model: str
    client: httpx.Client
    name: str = "groq"

    def complete_json(self, system: str, messages: list[Message], max_tokens: int) -> str:
        r = self.client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={
                "model": self.model,
                "messages": [{"role": "system", "content": system}, *messages],
                "response_format": {"type": "json_object"},
                "temperature": 0.8,
                "max_tokens": max_tokens,
            },
        )
        _check(r, "Groq")
        try:
            return r.json()["choices"][0]["message"]["content"]
        except (KeyError, IndexError) as e:
            raise LLMError(f"Groq: unexpected response ({e})") from e


@dataclass
class OllamaProvider:
    url: str
    model: str
    client: httpx.Client
    name: str = "ollama"

    def complete_json(self, system: str, messages: list[Message], max_tokens: int) -> str:
        try:
            r = self.client.post(
                f"{self.url.rstrip('/')}/api/chat",
                json={
                    "model": self.model,
                    "messages": [{"role": "system", "content": system}, *messages],
                    "format": "json",
                    "stream": False,
                    "options": {"temperature": 0.8, "num_predict": max_tokens},
                },
            )
        except httpx.ConnectError as e:
            raise LLMError(f"Ollama: not running at {self.url}") from e
        _check(r, "Ollama")
        return r.json().get("message", {}).get("content", "")


@dataclass
class FallbackChain:
    """Try providers in order. On a rate limit, wait (Retry-After, capped) a few times before moving on."""

    providers: list[LLMProvider]
    max_rate_limit_waits: int = 2
    max_backoff_s: float = 30.0
    sleep: Callable[[float], None] = time.sleep
    notes: list[str] = field(default_factory=list)

    def complete_json(self, system: str, messages: list[Message], max_tokens: int) -> tuple[str, str]:
        if not self.providers:
            raise AllProvidersFailed(
                "No LLM provider is configured. Set GEMINI_API_KEY (free at aistudio.google.com) or GROQ_API_KEY "
                "(free at console.groq.com) in backend/.env, or OLLAMA_MODEL for a local model."
            )
        failures = []
        for p in self.providers:
            waits = 0
            while True:
                try:
                    return p.name, p.complete_json(system, messages, max_tokens)
                except RateLimitError as e:
                    if waits < self.max_rate_limit_waits:
                        delay = min(e.retry_after if e.retry_after is not None else 5.0 * 2**waits, self.max_backoff_s)
                        self.notes.append(f"{p.name}: rate limited, waiting {delay:.0f}s")
                        self.sleep(delay)
                        waits += 1
                        continue
                    failures.append(f"{e} (still limited after {waits} waits)")
                    break
                except (LLMError, httpx.HTTPError) as e:
                    failures.append(str(e) if isinstance(e, LLMError) else f"{p.name}: {e}")
                    break
            self.notes.append(f"{p.name} failed, trying the next provider")
        raise AllProvidersFailed(
            "All LLM providers failed: " + " | ".join(failures)
            + ". Free tiers reset over time; wait a minute and try again, or add another provider key."
        )


def build_chain(settings: Settings, client: httpx.Client | None = None, sleep: Callable[[float], None] = time.sleep) -> FallbackChain:
    """Primary provider from LLM_PROVIDER first, then every other configured one."""
    client = client or httpx.Client(timeout=settings.llm_timeout_s)
    available: dict[str, LLMProvider] = {}
    if settings.gemini_api_key:
        available["gemini"] = GeminiProvider(settings.gemini_api_key, settings.gemini_model, client)
    if settings.groq_api_key:
        available["groq"] = GroqProvider(settings.groq_api_key, settings.groq_model, client)
    if settings.ollama_model:
        available["ollama"] = OllamaProvider(settings.ollama_url, settings.ollama_model, client)
    order = [settings.llm_provider] + [n for n in ("gemini", "groq", "ollama") if n != settings.llm_provider]
    return FallbackChain(
        [available[n] for n in order if n in available],
        max_rate_limit_waits=settings.llm_max_rate_limit_waits,
        max_backoff_s=settings.llm_max_backoff_s,
        sleep=sleep,
    )
