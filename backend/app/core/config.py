"""Settings from environment / backend/.env. Only free services are supported."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    # LLM: primary provider; the others with credentials are tried as fallbacks.
    llm_provider: Literal["gemini", "groq", "ollama"] = "gemini"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-flash-latest"
    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-120b"
    # Extra Groq models tried as writers after the main ones; each has its own free daily token cap.
    groq_fallback_models: str = "qwen/qwen3.8-27b"
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = ""  # empty = Ollama not used

    # Fact-check models, tried in order; the exact provider:model that wrote the story is always skipped,
    # so a story is never checked by its own writer.
    grounding_models: str = "groq:qwen/qwen3.8-27b,groq:openai/gpt-oss-20b,gemini:gemini-flash-latest"

    # Landmark images (free tiers only): tried in this order, each skipped without credentials.
    image_providers: str = "cloudflare,huggingface"
    cloudflare_account_id: str = ""
    cloudflare_api_token: str = ""
    cloudflare_image_model: str = "@cf/black-forest-labs/flux-1-schnell"
    hf_token: str = ""
    hf_image_models: str = "black-forest-labs/FLUX.1-schnell,stabilityai/stable-diffusion-xl-base-1.0"
    image_timeout_s: float = 120.0
    landmark_images: bool = True  # set false to skip painting landmarks entirely

    # Keep requests small so free-tier limits hold.
    llm_max_output_tokens: int = 2000
    llm_timeout_s: float = 90.0
    llm_max_rate_limit_waits: int = 3
    llm_max_backoff_s: float = 60.0  # per-minute token windows need up to a full minute

    # Retrieval
    wiki_lang: str = "en"
    min_content_words: int = 350
    max_source_words: int = 1400
    cache_ttl_days: int = 7
    # Wikimedia's User-Agent policy requires a way to reach you (email or URL); requests without it get 403.
    http_contact: str = ""

    @property
    def http_user_agent(self) -> str:
        return f"MythForge/0.1 ({self.http_contact}; local development project, not deployed) python-httpx"

    database_url: str = f"sqlite:///{(BACKEND_DIR / 'mythforge.db').as_posix()}"

    # Dev servers allowed to call the API (localhost + LAN addresses on the Vite port).
    cors_origin_regex: str = r"^http://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$"


@lru_cache
def get_settings() -> Settings:
    return Settings()
