"""SQLAlchemy engine/session for the local SQLite database."""

from collections.abc import Iterator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


def make_engine(url: str | None = None):
    url = url or get_settings().database_url
    # SQLite + background tasks on other threads.
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, connect_args=connect_args)


engine = make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db(bind=None) -> None:
    from app import models  # noqa: F401  (register tables)

    bind = bind or engine
    Base.metadata.create_all(bind=bind)
    _add_missing_columns(bind)


def _add_missing_columns(bind) -> None:
    """create_all never alters existing tables; add new nullable columns to an older local database."""
    insp = inspect(bind)
    with bind.begin() as conn:
        for table in Base.metadata.sorted_tables:
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name not in existing and col.nullable:
                    conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN {col.name} {col.type.compile(bind.dialect)}'))


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
