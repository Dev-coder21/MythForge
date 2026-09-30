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
    def __init__(self, message: str, retry_after: float | None = None, daily: bool = False):
        super().__init__(message)
        self.retry_after = retry_after
        self.daily = daily  # a per-day quota: waiting seconds will not help


class AllProvidersFailed(LLMError):
    """Every configured provider failed; the message says why, per provider."""


Message = dict  # {"role": "user" | "assistant", "content": str}


class LLMProvider(Protocol):
    name: str
    model: str

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
        daily = bool(re.search(r"per ?day|PerDay|daily", response.text, re.IGNORECASE))
        kind = "daily free-tier quota used up" if daily else "rate limited (free-tier quota reached)"
        raise RateLimitError(f"{provider}: {kind}", _retry_after(response), daily=daily)
    if response.status_code in (500, 502, 503, 504):
        # Overloaded or briefly down: worth a short wait before falling back.
        raise RateLimitError(f"{provider}: temporarily unavailable (HTTP {response.status_code})", _retry_after(response) or 8.0)
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
        body = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, *messages],
            "response_format": {"type": "json_object"},
            "temperature": 0.8,
            "max_tokens": max_tokens,
        }
        if "gpt-oss" in self.model:
            body["reasoning_effort"] = "low"  # reasoning tokens share max_tokens and the free per-minute budget
        r = self.client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json=body,
        )
        if r.status_code == 400 and "json_validate_failed" in r.text:
            # Groq rejected malformed JSON server-side; hand it back so the pipeline asks for a correction.
            return r.json().get("error", {}).get("failed_generation", "") or "(empty response)"
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
    bench_s: float = 300.0  # skip a provider this long after it fails, so later calls don't re-wait on it
    clock: Callable[[], float] = time.monotonic
    _benched: dict[str, float] = field(default_factory=dict)
    last_model: str = ""  # "provider:model" of the last successful call
    # Live progress for the UI: (provider:model, message). Called on each attempt, wait and failure.
    on_event: Callable[[str, str], None] | None = None

    def _event(self, p: LLMProvider, message: str) -> None:
        if self.on_event:
            self.on_event(model_id(p), message)

    def complete_json(self, system: str, messages: list[Message], max_tokens: int) -> tuple[str, str]:
        if not self.providers:
            raise AllProvidersFailed(
                "No LLM provider is configured. Set GEMINI_API_KEY (free at aistudio.google.com) or GROQ_API_KEY "
                "(free at console.groq.com) in backend/.env, or OLLAMA_MODEL for a local model."
            )
        failures = []
        now = self.clock()
        active = [p for p in self.providers if self._benched.get(model_id(p), 0) <= now] or self.providers
        for p in active:
            waits = 0
            while True:
                self._event(p, "working")
                try:
                    out = p.complete_json(system, messages, max_tokens)
                    self.last_model = model_id(p)
                    return p.name, out
                except RateLimitError as e:
                    if waits < self.max_rate_limit_waits and not e.daily:
                        delay = min(e.retry_after if e.retry_after is not None else 5.0 * 2**waits, self.max_backoff_s)
                        self.notes.append(f"{p.name}: rate limited, waiting {delay:.0f}s")
                        self._event(p, f"rate limited, waiting {delay:.0f}s")
                        self.sleep(delay)
                        waits += 1
                        continue
                    failures.append(f"{e} (still limited after {waits} waits)")
                    break
                except (LLMError, httpx.HTTPError) as e:
                    failures.append(str(e) if isinstance(e, LLMError) else f"{p.name}: {e}")
                    break
            self._benched[model_id(p)] = self.clock() + self.bench_s
            self.notes.append(f"{p.name} failed, trying the next provider")
            self._event(p, "unavailable, trying the next provider")
        raise AllProvidersFailed(
            "All LLM providers failed: " + " | ".join(failures)
            + ". Free tiers reset over time; wait a minute and try again, or add another provider key."
        )


def model_id(p: LLMProvider) -> str:
    return f"{p.name}:{p.model}"


def build_checker_chain(settings: Settings, exclude: str, client: httpx.Client | None = None,
                        sleep: Callable[[float], None] = time.sleep) -> FallbackChain:
    """Fact-check chain from GROUNDING_MODELS, minus the writer's provider:model and anything without credentials."""
    client = client or httpx.Client(timeout=settings.llm_timeout_s)
    providers: list[LLMProvider] = []
    for entry in (e.strip() for e in settings.grounding_models.split(",") if e.strip()):
        name, _, model = entry.partition(":")
        if f"{name}:{model}" == exclude:
            continue
        if name == "groq" and settings.groq_api_key:
            providers.append(GroqProvider(settings.groq_api_key, model, client))
        elif name == "gemini" and settings.gemini_api_key:
            providers.append(GeminiProvider(settings.gemini_api_key, model, client))
        elif name == "ollama" and model:
            providers.append(OllamaProvider(settings.ollama_url, model, client))
    return FallbackChain(providers, max_rate_limit_waits=settings.llm_max_rate_limit_waits,
                         max_backoff_s=settings.llm_max_backoff_s, sleep=sleep)


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
