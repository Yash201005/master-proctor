-- Reference schema; tables are also created by SQLAlchemy at startup.
CREATE TABLE IF NOT EXISTS users (id VARCHAR(40) PRIMARY KEY, name VARCHAR(100), role VARCHAR(20), password_hash VARCHAR(200));
CREATE TABLE IF NOT EXISTS candidate_sessions (candidate_id VARCHAR(40) PRIMARY KEY, exam_id VARCHAR(40), status VARCHAR(20), last_heartbeat TIMESTAMPTZ, latency_ms FLOAT, network VARCHAR(12));
CREATE TABLE IF NOT EXISTS events (id SERIAL PRIMARY KEY, event_id VARCHAR(64) UNIQUE, candidate_id VARCHAR(40), exam_id VARCHAR(40), event_type VARCHAR(40), event_category VARCHAR(30), severity VARCHAR(10), detection_source VARCHAR(30), confidence VARCHAR(12), event_description TEXT, timestamp TIMESTAMPTZ, duration FLOAT, metadata JSON);
