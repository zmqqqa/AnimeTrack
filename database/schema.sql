-- Anime table
CREATE TABLE IF NOT EXISTS anime (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    original_title VARCHAR(255),
    coverUrl VARCHAR(512),
    status VARCHAR(50) NOT NULL,
    score DECIMAL(3, 1),
    progress INT DEFAULT 0,
    totalEpisodes INT,
    durationMinutes INT,
    notes TEXT,
    tags JSON,
    summary TEXT,
    start_date DATE,
    end_date DATE,
    premiere_date DATE,
    cast JSON,
    cast_aliases JSON,
    isFinished TINYINT(1) DEFAULT 0,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_anime_status (status),
    INDEX idx_anime_updatedAt (updatedAt)
);

-- Watch history table
CREATE TABLE IF NOT EXISTS watch_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    animeId INT NOT NULL,
    animeTitle VARCHAR(255) NOT NULL,
    episode INT NOT NULL,
    watchedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_watch_history_animeId (animeId),
    INDEX idx_watch_history_watchedAt (watchedAt),
    CONSTRAINT fk_watch_history_anime FOREIGN KEY (animeId) REFERENCES anime(id) ON DELETE CASCADE
);

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100),
    role VARCHAR(20) NOT NULL DEFAULT 'user',
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_users_role (role)
);

-- Access logs table
CREATE TABLE IF NOT EXISTS access_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    pathname VARCHAR(255) NOT NULL,
    visitor_id VARCHAR(64) NOT NULL,
    session_id VARCHAR(64) NOT NULL,
    referrer VARCHAR(512),
    user_agent VARCHAR(255),
    ip_address VARCHAR(64),
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_access_logs_createdAt (createdAt),
    INDEX idx_access_logs_path_createdAt (pathname, createdAt),
    INDEX idx_access_logs_visitor_createdAt (visitor_id, createdAt),
    INDEX idx_access_logs_session_createdAt (session_id, createdAt)
);
