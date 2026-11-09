CREATE DATABASE IF NOT EXISTS moviepick01
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE moviepick01;

CREATE TABLE IF NOT EXISTS movie_clicks (
  movie_id INT PRIMARY KEY,
  click_count INT NOT NULL DEFAULT 0
);

DESC movie_clicks;