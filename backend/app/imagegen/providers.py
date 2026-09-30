"""
Free image providers behind one interface, called over plain HTTP:
- Cloudflare Workers AI (daily free allowance), FLUX.1-schnell
- Hugging Face Inference (free monthly credits), FLUX.1-schnell then SDXL
Same failure semantics as the text chain (RateLimitError, daily vs per-minute),
tried in order with capped backoff. One request at a time: the caller is a queue.
"""

from __future__ import annotations

import base64
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Protocol

import httpx

from app.core.config import Settings
from app.llm_pipeline.providers import LLMError, RateLimitError, _check


class ImageProvider(Protocol):
    name: str
    model: str

    def generate(self, prompt: str, seed: int) -> bytes: ...


def _image_bytes(data: bytes, provider: str) -> bytes:
    if not (data.startswith(b"\x89PNG") or data.startswith(b"\xff\xd8") or data[:4] == b"RIFF"):
        raise LLMError(f"{provider}: response was not an image")
    return data


@dataclass
class CloudflareImages:
    account_id: str
    token: str
    model: str
    client: httpx.Client
    name: str = "cloudflare"

    def generate(self, prompt: str, seed: int) -> bytes:
        url = f"https://api.cloudflare.com/client/v4/accounts/{self.account_id}/ai/run/{self.model}"
        r = self.client.post(url, headers={"Authorization": f"Bearer {self.token}"}, json={"prompt": prompt, "steps": 8})  # flux-1-schnell takes no seed
        if r.status_code == 429 or (r.status_code >= 400 and "neurons" in r.text.lower()):
            # Workers AI reports the free daily neuron allowance being used up as a 4xx mentioning neurons.
            raise RateLimitError("Cloudflare: daily free allowance used up" if "neurons" in r.text.lower() else "Cloudflare: rate limited",
                                 retry_after=None, daily="neurons" in r.text.lower())
        _check(r, "Cloudflare")
        if r.headers.get("content-type", "").startswith("image/"):
            return _image_bytes(r.content, "Cloudflare")
        try:
            b64 = r.json()["result"]["image"]
        except (KeyError, ValueError) as e:
            raise LLMError(f"Cloudflare: unexpected response ({e})") from e
        return _image_bytes(base64.b64decode(b64), "Cloudflare")


@dataclass
class HuggingFaceImages:
    token: str
    model: str
    client: httpx.Client
    name: str = "huggingface"

    def generate(self, prompt: str, seed: int) -> bytes:
        # model = "partner:repo" routed through Hugging Face (free monthly credits), OpenAI-style images API.
        partner, _, repo = self.model.partition(":")
        r = self.client.post(
            f"https://router.huggingface.co/{partner}/v1/images/generations",
            headers={"Authorization": f"Bearer {self.token}"},
            json={"model": repo, "prompt": prompt, "response_format": "b64_json"},
        )
        if r.status_code == 402:
            # Free monthly credits exhausted: treat like a daily quota (waiting will not help).
            raise RateLimitError("Hugging Face: free monthly credits used up", daily=True)
        if r.status_code == 503:
            raise RateLimitError("Hugging Face: model is loading", retry_after=20.0)
        _check(r, "Hugging Face")
        try:
            return _image_bytes(base64.b64decode(r.json()["data"][0]["b64_json"]), "Hugging Face")
        except (KeyError, IndexError, ValueError) as e:
            raise LLMError(f"Hugging Face: unexpected response ({e})") from e


class AllImageProvidersFailed(LLMError):
    """No provider produced an image; the message says why, per provider."""


@dataclass
class ImageChain:
    providers: list[ImageProvider]
    max_rate_limit_waits: int = 2
    max_backoff_s: float = 60.0
    sleep: Callable[[float], None] = time.sleep
    on_event: Callable[[str, str], None] | None = None
    last_model: str = ""
    notes: list[str] = field(default_factory=list)

    def _event(self, p: ImageProvider, msg: str) -> None:
        if self.on_event:
            self.on_event(f"{p.name}:{p.model}", msg)

    def generate(self, prompt: str, seed: int) -> bytes:
        if not self.providers:
            raise AllImageProvidersFailed(
                "No image provider is configured. Add CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (free Workers AI) "
                "or HF_TOKEN (free Hugging Face token) to backend/.env."
            )
        failures = []
        for p in self.providers:
            waits = 0
            while True:
                self._event(p, "painting")
                try:
                    out = p.generate(prompt, seed)
                    self.last_model = f"{p.name}:{p.model}"
                    return out
                except RateLimitError as e:
                    if waits < self.max_rate_limit_waits and not e.daily:
                        delay = min(e.retry_after if e.retry_after is not None else 10.0 * 2**waits, self.max_backoff_s)
                        self.notes.append(f"{p.name}: {e}, waiting {delay:.0f}s")
                        self._event(p, f"rate limited, waiting {delay:.0f}s")
                        self.sleep(delay)
                        waits += 1
                        continue
                    failures.append(str(e))
                    break
                except (LLMError, httpx.HTTPError) as e:
                    failures.append(str(e) if isinstance(e, LLMError) else f"{p.name}: {e}")
                    break
            self._event(p, "unavailable, trying the next provider")
        raise AllImageProvidersFailed("All image providers failed: " + " | ".join(failures))


def build_image_chain(settings: Settings, client: httpx.Client | None = None, sleep: Callable[[float], None] = time.sleep) -> ImageChain:
    client = client or httpx.Client(timeout=settings.image_timeout_s)
    providers: list[ImageProvider] = []
    for name in (n.strip() for n in settings.image_providers.split(",") if n.strip()):
        if name == "cloudflare" and settings.cloudflare_account_id and settings.cloudflare_api_token:
            providers.append(CloudflareImages(settings.cloudflare_account_id, settings.cloudflare_api_token, settings.cloudflare_image_model, client))
        elif name == "huggingface" and settings.hf_token:
            for model in (m.strip() for m in settings.hf_image_models.split(",") if m.strip()):
                providers.append(HuggingFaceImages(settings.hf_token, model, client))
    return ImageChain(providers, max_backoff_s=settings.llm_max_backoff_s, sleep=sleep)
