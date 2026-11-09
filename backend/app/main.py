import os
import requests
import mysql.connector

from datetime import datetime, timezone

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient
from pydantic import BaseModel, Field

load_dotenv()
TMDB_URL = "https://api.themoviedb.org/3"
KAKAO_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"

def mysql_connection():
  return mysql.connector.connect(
    host=os.getenv("MYSQL_HOST", "127.0.0.1"),
    port=int(os.getenv("MYSQL_PORT", "3306")),
    user=os.getenv("MYSQL_USER", "root"),
    password=os.getenv("MYSQL_PASSWORD", ""),
    database=os.getenv("MYSQL_DATABASE", "moviepick01"),
    connection_timeout=4
  )

def mongo_collection():
  client = MongoClient(os.getenv("MONGO_URI", "mongodb://127.0.0.1:27017"), ServerSelectionTimeoutMS=4000)
  client.admin.command("ping")
  return client, client[os.getenv("MONGO_DATABASE", "moviepick01")]["events"]

def remote_json(url, headers=None, params=None):
  try:
    response = requests.get(url, headers=headers, params=params, timeout=12)
    response.raise_for_status()
    return response.json()
  except requests.RequestException as exc:
    raise HTTPException(status_code=502, detail=f"외부 API 요청 실패: {exc}") from exc

def tmdb(path, params=None):
  token = os.getenv("TMDB_BEARER_TOKEN")
  if not token or token.startswith("YOUR_"):
    raise HTTPException(503, "TMDB_BEARER_TOKEN을 설정하세요.")
  return remote_json(f"{TMDB_URL}{path}", headers={"Authorization": f"Bearer {token}"}, params={"language": "ko-KR", **(params or {})})

def log_event(event_type, movie_id=None, keyword=None):
  client = None
  try :
    client, coll = mongo_collection()
    coll.insert_one({"event_type": event_type, "movie_id": movie_id, "keyword": keyword, "created_at": datetime.now(timezone.utc)})
  except Exception as exc :
    raise HTTPException(503, f"MongoDB 저장 실패: {exc}") from exc
  finally :
    if client is not None :
      client.close()

app = FastAPI(title="MoviePick API", version="1.0.0")
app.add_middleware(
  CORSMiddleware,
  allow_origins=[os.getenv("FRONTEND_ORIGIN", "http://127.0.0.1:5173")],
  allow_credentials=False,
  allow_methods=["GET", "POST"],
  allow_headers=["Content-Type"]
)

class ClickEvent(BaseModel):
    movie_id: int = Field(gt=0)

@app.get("/health")
def health():
    return {"status": "ok", "time_utc": datetime.now(timezone.utc).isoformat()}

@app.get("/movies/trending")
def trending():
    return tmdb("/trending/movie/week", {"page": 1})

@app.get("/movies/search")
def search_movies(q: str = Query(min_length=1, max_length=100)):
    result = tmdb("/search/movie", {"query": q, "page": 1, "include_adult": "false"})
    log_event("search", keyword=q)
    return result

@app.get("/movies/{movie_id}")
def movie_detail(movie_id: int):
    return tmdb(f"/movie/{movie_id}")

@app.post("/events/click")
def movie_click(payload: ClickEvent):
    conn = None
    cursor = None
    try:
        conn = mysql_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO movie_clicks (movie_id, click_count)
            VALUES (%s, 1)
            ON DUPLICATE KEY UPDATE click_count = click_count + 1
        """, (payload.movie_id,))
        conn.commit()
    except mysql.connector.Error as exc:
        if conn:
            conn.rollback()
        raise HTTPException(503, f"MySQL 저장 실패: {exc}") from exc
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
    log_event("movie_click", movie_id=payload.movie_id)
    return {"ok": True}

@app.get("/stats/popular")
def popular():
    conn = None
    cursor = None
    try:
        conn = mysql_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT movie_id, click_count FROM movie_clicks ORDER BY click_count DESC, movie_id ASC LIMIT 10")
        return {"results": cursor.fetchall()}
    except mysql.connector.Error as exc:
        raise HTTPException(503, f"MySQL 조회 실패: {exc}") from exc
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

@app.get("/cinemas")
def cinemas(q: str = Query(default="수원 영화관", min_length=1, max_length=100)):
    key = os.getenv("KAKAO_REST_API_KEY")
    if not key or key.startswith("YOUR_"):
        raise HTTPException(503, "KAKAO_REST_API_KEY를 설정하세요.")
    data = remote_json(KAKAO_URL, headers={"Authorization": f"KakaoAK {key}"}, params={"query": q, "size": 15})
    return {"results": [{"name": p["place_name"], "address": p.get("road_address_name") or p.get("address_name"), "url": p.get("place_url"), "phone": p.get("phone", "")} for p in data.get("documents", [])]}

@app.get("/cinemas/nearby")
def nearby_cinemas(
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
    radius: int = Query(default=5000, ge=100, le=20000),
    page: int = Query(default=1, ge=1, le=3),
):
    key = os.getenv("KAKAO_REST_API_KEY")
    if not key or key.startswith("YOUR_"):
        raise HTTPException(503, "KAKAO_REST_API_KEY를 설정하세요.")
    data = remote_json(
        KAKAO_URL,
        headers={"Authorization": f"KakaoAK {key}"},
        params={
            "query": "영화관", "x": lng, "y": lat,
            "radius": radius, "sort": "distance", "size": 15, "page": page,
        },
    )
    return {
        "count": len(data.get("documents", [])),
        "radius": radius,
        "is_end": data.get("meta", {}).get("is_end", True),
        "results": [
            {
                "id": p.get("id"),
                "name": p.get("place_name", ""),
                "address": p.get("road_address_name") or p.get("address_name", ""),
                "phone": p.get("phone", ""),
                "distance": int(p["distance"]) if p.get("distance") else None,
                "url": p.get("place_url", ""),
            }
            for p in data.get("documents", [])
        ],
    }