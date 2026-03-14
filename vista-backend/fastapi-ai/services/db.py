import os
from pathlib import Path
from urllib.parse import quote_plus
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv


load_dotenv()

DATABASE_URL = (
    f"postgresql+asyncpg://{os.getenv('DB_USER', 'postgres')}:"
    f"{quote_plus(os.getenv('DB_PASSWORD', ''))}@"
    f"{os.getenv('DB_HOST', 'localhost')}:"
    f"{os.getenv('DB_PORT', '5432')}/"
    f"{os.getenv('DB_NAME', 'vista_db')}"
)


engine = create_async_engine(
    DATABASE_URL, 
    echo=False, 
    pool_size=10)


AsyncSessionLocal = sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False
)


async def init_db():
    """Verify database connection on startup."""
    async with engine.connect() as conn:
        await conn.execute(__import__('sqlalchemy').text("SELECT 1"))
    print("✅ AI Service connected to PostgreSQL")


async def get_db():
    """FastAPI dependency for DB session."""
    async with AsyncSessionLocal() as session:
        yield session