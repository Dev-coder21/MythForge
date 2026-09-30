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
    gemini_model: str = "gemini-2.5-flash"
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = ""  # empty = Ollama not used

    # Keep requests small so free-tier limits hold.
    llm_max_output_tokens: int = 3000
    llm_timeout_s: float = 90.0
    llm_max_rate_limit_waits: int = 2
    llm_max_backoff_s: float = 30.0

    # Retrieval
    wiki_lang: str = "en"
    min_content_words: int = 350
    max_source_words: int = 1800
    cache_ttl_days: int = 7
    http_user_agent: str = "MythForge/0.1 (local development project; not deployed)"

    database_url: str = f"sqlite:///{(BACKEND_DIR / 'mythforge.db').as_posix()}"

    # Dev servers allowed to call the API (localhost + LAN addresses on the Vite port).
    cors_origin_regex: str = r"^http://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$"


@lru_cache
def get_settings() -> Settings:
    return Settings()
