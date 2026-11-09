import React, { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { trackEvent } from "./analytics";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
const poster = (path) => (path ? `https://image.tmdb.org/t/p/w342${path}` : "");
async function api(path, options) {
  const res = await fetch(`${API}${path}`, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || `HTTP ${res.status}`);
  return body;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [query, setQuery] = useState("");
  const [movies, setMovies] = useState([]);
  const [selected, setSelected] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [cinemaQuery, setCinemaQuery] = useState("수원 영화관");
  const [cinemas, setCinemas] = useState([]);
  const [locating, setLocating] = useState(false);
  const [searchRadius, setSearchRadius] = useState(5000);
  const [locationMessage, setLocationMessage] = useState("");
  const [stats, setStats] = useState([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    api("/movies/trending")
      .then((d) => setMovies(d.results || []))
      .catch((e) => setMessage(e.message));
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session?.user) {
      setFavorites([]);
      return;
    }
    loadFavorites(session.user.id);
  }, [session?.user?.id]);

  async function loadFavorites(userId) {
    const { data, error } = await supabase
      .from("favorites")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) setMessage(error.message);
    else setFavorites(data || []);
  }
  async function search(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    try {
      const d = await api(
        `/movies/search?q=${encodeURIComponent(query.trim())}`,
      );
      setMovies(d.results || []);
      setSelected(null);
      setMessage("검색 완료");

      trackEvent("search", {
        search_term: query.trim(),
        result_count: d.results?.length || 0,
      });
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function detail(movie) {
    setBusy(true);
    try {
      const d = await api(`/movies/${movie.id}`);
      setSelected(d);
      trackEvent("select_content", {
        content_type: "movie",
        item_id: String(movie.id),
        movie_title: movie.title,
      });
      // 조회 성공과 클릭 집계 성공은 별개이므로 오류를 사용자에게 알립니다.
      try {
        await api("/events/click", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ movie_id: movie.id }),
        });
      } catch (e) {
        setMessage(`영화 상세는 표시되지만 클릭 저장 실패: ${e.message}`);
      }
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function auth(mode) {
    try {
      const result =
        mode === "signup"
          ? await supabase.auth.signUp({ email, password })
          : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (mode === "signup") {
        trackcEvent("sign_up", {
          method: email,
        });
      } else {
        trackEvent("login", {
          method: "email",
        });
      }
      setMessage(
        mode === "signup"
          ? "가입 요청 완료. 이메일 확인이 활성화되어 있다면 인증 메일을 확인하세요."
          : "로그인 완료",
      );
    } catch (e) {
      setMessage(e.message);
    }
  }
  async function toggleFavorite(movie) {
    if (!session?.user) {
      setMessage("즐겨찾기를 사용하려면 로그인하세요.");
      return;
    }
    const found = favorites.find((f) => f.movie_id === movie.id);
    const result = found
      ? await supabase.from("favorites").delete().eq("id", found.id)
      : await supabase.from("favorites").insert({
          user_id: session.user.id,
          movie_id: movie.id,
          movie_title: movie.title,
          poster_path: movie.poster_path,
        });
    if (result.error) setMessage(result.error.message);
    else {
      await loadFavorites(session.user.id);
      setMessage(found ? "즐겨찾기 삭제" : "즐겨찾기 추가");

      if (found) {
        trackEvent("remove_from_wishlist", {
          movie_id: String(movie.id),
          movie_title: movie.title,
        });
      } else {
        trackEvent("add_to_wishlist", {
          currency: "KRW",
          items: [
            {
              item_id: String(movie.id),
              item_name: movie.title,
            },
          ],
        });
      }
    }
  }
  async function searchCinemas(e) {
    e.preventDefault();
    try {
      const d = await api(`/cinemas?q=${encodeURIComponent(cinemaQuery)}`);
      setCinemas(d.results || []);
      setMessage("영화관 검색 완료");

      trackEvent("cinema_search", {
        search_term: cinemaQuery.trim(),
        search_type: "keyword",
        result_count: d.result?.lenghth || 0,
      });
    } catch (e) {
      setMessage(e.message);
    }
  }
  async function findNearbyCinemas() {
    if (!navigator.geolocation) {
      setLocationMessage("이 브라우저는 위치 조회를 지원하지 않습니다.");
      return;
    }
    setLocating(true);
    setLocationMessage("위치 권한을 확인하고 있습니다...");
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const params = new URLSearchParams({
            lat: String(coords.latitude),
            lng: String(coords.longitude),
            radius: String(searchRadius),
          });
          const data = await api(`/cinemas/nearby?${params}`);
          setCinemas(data.results || []);
          setLocationMessage(
            `반경 ${searchRadius / 1000}km · 첫 페이지 ${data.count}건 조회${data.is_end ? "" : " (추가 페이지 있음)"}`,
          );

          trackEvent("nearby_cinema_search", {
            search_type: "gps",
            radius_km: searchRadius / 1000,
            result_count: data.results?.length || 0,
          });
        } catch (e) {
          setLocationMessage(e.message);
        } finally {
          setLocating(false);
        }
      },
      (error) => {
        const messages = {
          1: "위치 권한이 거부되었습니다. 브라우저 설정을 확인하세요.",
          2: "위치를 확인할 수 없습니다.",
          3: "위치 조회 시간이 초과되었습니다.",
        };
        setLocationMessage(messages[error.code] || "위치 조회 실패");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }
  async function loadStats() {
    try {
      const d = await api("/stats/popular");
      setStats(d.results || []);
      setMessage("통계 조회 완료");
    } catch (e) {
      setMessage(e.message);
    }
  }
  return (
    <div className="shell">
      <header>
        <div>
          <h1
            onClick={() => window.location.reload()}
            style={{ cursor: "pointer" }}
          >
            🎬 MoviePick
          </h1>
          <p>React · TMDB · Supabase · Kakao · FastAPI · MySQL · MongoDB</p>
        </div>
        <div className="auth">
          {session ? (
            <>
              <small>{session.user.email}</small>
              <button onClick={() => supabase.auth.signOut()}>로그아웃</button>
            </>
          ) : (
            <>
              <input
                aria-label="이메일"
                type="email"
                placeholder="이메일"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                aria-label="비밀번호"
                type="password"
                placeholder="비밀번호 (6자 이상)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button onClick={() => auth("login")}>로그인</button>
              <button className="secondary" onClick={() => auth("signup")}>
                회원가입
              </button>
            </>
          )}
        </div>
      </header>
      <p className="notice" role="status">
        {message || "인기 영화를 살펴보세요."}
      </p>
      <section>
        <h2>영화 찾기</h2>
        <form onSubmit={search} className="search">
          <input
            placeholder="예: 기생충, 인셉션"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button disabled={busy}>검색</button>
        </form>
        <div className="movies">
          {movies.map((movie) => (
            <article key={movie.id} className="movie">
              {poster(movie.poster_path) ? (
                <img
                  src={poster(movie.poster_path)}
                  alt={`${movie.title} 포스터`}
                  loading="lazy"
                />
              ) : (
                <div className="noimage">포스터 없음</div>
              )}
              <h3>{movie.title}</h3>
              <p>
                ⭐ {movie.vote_average?.toFixed(1) ?? "-"} ·{" "}
                {movie.release_date || "개봉일 미정"}
              </p>
              <div className="actions">
                <button onClick={() => detail(movie)}>상세</button>
                <button
                  className="secondary"
                  onClick={() => toggleFavorite(movie)}
                >
                  {favorites.some((f) => f.movie_id === movie.id)
                    ? "♥ 저장됨"
                    : "♡ 저장"}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      {selected && (
        <section className="detail">
          <h2>{selected.title}</h2>
          <p>{selected.overview || "줄거리 정보가 없습니다."}</p>
          <p>
            개봉일: {selected.release_date || "-"} / 평점:{" "}
            {selected.vote_average?.toFixed(1) ?? "-"}
          </p>
          <button onClick={() => setSelected(null)}>상세 닫기</button>
        </section>
      )}
      <section>
        <h2>내 즐겨찾기 ({favorites.length})</h2>
        {session ? (
          <div className="chips">
            {favorites.map((f) => (
              <button
                className="secondary"
                key={f.id}
                onClick={() => toggleFavorite({ id: f.movie_id })}
              >
                {f.movie_title} ×
              </button>
            ))}
          </div>
        ) : (
          <p>로그인하면 즐겨찾기를 저장할 수 있습니다.</p>
        )}
      </section>
      <section>
        <h2>영화관 찾기 (Kakao)</h2>
        <h3>지역명으로 검색</h3>
        <form className="search" onSubmit={searchCinemas}>
          <input
            aria-label="영화관 검색어"
            value={cinemaQuery}
            onChange={(e) => setCinemaQuery(e.target.value)}
            placeholder="예: 수원 영화관"
          />
          <button type="submit">장소 검색</button>
        </form>
        <h3>📍 내 위치로 주변 영화관 찾기</h3>
        <div className="search">
          <label htmlFor="radius">검색 반경</label>
          <select
            id="radius"
            value={searchRadius}
            onChange={(e) => setSearchRadius(Number(e.target.value))}
          >
            <option value={1000}>1km</option>
            <option value={3000}>3km</option>
            <option value={5000}>5km</option>
            <option value={10000}>10km</option>
            <option value={20000}>20km</option>
          </select>
          <button type="button" disabled={locating} onClick={findNearbyCinemas}>
            {locating ? "위치 확인 중..." : "내 위치로 찾기"}
          </button>
        </div>
        <p role="status">{locationMessage}</p>
        <div className="results">
          {cinemas.map((c, i) => (
            <article key={c.id || `${c.url}-${i}`}>
              <h3>{c.name}</h3>
              <p>{c.address || "주소 없음"}</p>
              {c.distance != null && (
                <p>
                  직선거리:{" "}
                  {c.distance >= 1000
                    ? `${(c.distance / 1000).toFixed(1)}km`
                    : `${c.distance}m`}
                </p>
              )}
              {c.phone && <p>전화: {c.phone}</p>}
              {c.url && (
                <a href={c.url} target="_blank" rel="noopener noreferrer">
                  카카오맵 보기
                </a>
              )}
            </article>
          ))}
        </div>
      </section>
      <section>
        <h2>인기 영화 클릭 통계 (MySQL)</h2>
        <button onClick={loadStats}>통계 새로고침</button>
        <ol>
          {stats.map((s) => (
            <li key={s.movie_id}>
              TMDB 영화 ID {s.movie_id}: {s.click_count}회
            </li>
          ))}
        </ol>
        <small>MongoDB에는 각 검색·클릭 이벤트가 개별 문서로 저장됩니다.</small>
      </section>
      <footer>
        Movie data provided by TMDB. This product uses the TMDB API but is not
        endorsed or certified by TMDB.
      </footer>
    </div>
  );
}
