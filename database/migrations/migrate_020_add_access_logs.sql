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