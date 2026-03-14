import asyncpg, asyncio

async def test():
    conn = await asyncpg.connect(
        user="postgres",
        password="$Ti@2023",
        host="127.0.0",
        port=5432,
        database="vista_db"
    )
    print("Connected!")
    await conn.close()

asyncio.run(test())