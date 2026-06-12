CREATE TABLE IF NOT EXISTS `saved_data_sources` (
  `id` int NOT NULL AUTO_INCREMENT,
  `data_source_id` varchar(64) NOT NULL,
  `name` varchar(255) NOT NULL,
  `type` enum('mysql','postgresql','sqlite','sqlserver','oracle','csv','json','xml','xlsx') NOT NULL,
  `db_host` varchar(255) NULL,
  `db_port` int NULL,
  `db_database` varchar(255) NULL,
  `db_schema` varchar(255) NULL,
  `db_username` varchar(255) NULL,
  `db_password` varchar(512) NULL,
  `file_name` varchar(255) NULL,
  `file_type` enum('csv','json','xml','xlsx') NULL,
  `file_path` varchar(500) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `saved_data_sources_data_source_id` (`data_source_id`)
);

CREATE TABLE IF NOT EXISTS `cleaning_sessions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `session_id` varchar(64) NOT NULL,
  `data_source_id` varchar(64) NULL,
  `session_title` varchar(255) NULL,
  `current_phase` enum('idle','explore','analyze','confirm','generate','execute','retry') NOT NULL DEFAULT 'idle',
  `data_source_type` enum('mysql','postgresql','sqlite','sqlserver','oracle','csv','json','xml','xlsx') NULL,
  `data_source_name` varchar(255) NULL,
  `target_table` varchar(255) NULL,
  `db_host` varchar(255) NULL,
  `db_port` int NULL,
  `db_database` varchar(255) NULL,
  `db_schema` varchar(255) NULL,
  `file_name` varchar(255) NULL,
  `file_type` enum('csv','json','xml','xlsx') NULL,
  `file_path` varchar(500) NULL,
  `  retry_count` int NOT NULL DEFAULT 0,
  `current_run_index` int NOT NULL DEFAULT 1,
  `last_action` varchar(100) NULL,
  `contract_yaml` text NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `cleaning_sessions_session_id` (`session_id`)
);

CREATE TABLE IF NOT EXISTS `exploration_results` (
  `id` int NOT NULL AUTO_INCREMENT,
  `session_id` varchar(64) NOT NULL,
  `run_index` int NOT NULL DEFAULT 1,
  `source_type` varchar(50) NOT NULL,
  `source_name` varchar(255) NOT NULL,
  `total_rows` int NOT NULL,
  `total_cols` int NOT NULL,
  `schema` json NOT NULL,
  `sample_data` json NOT NULL,
  `column_stats` json NOT NULL,
  `issues` json NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE IF NOT EXISTS `quality_reports` (
  `id` int NOT NULL AUTO_INCREMENT,
  `session_id` varchar(64) NOT NULL,
  `run_index` int NOT NULL DEFAULT 1,
  `phase` enum('before','after') NOT NULL DEFAULT 'before',
  `overall_score` int NOT NULL,
  `completeness_score` int NOT NULL,
  `uniqueness_score` int NOT NULL,
  `consistency_score` int NOT NULL,
  `validity_score` int NOT NULL,
  `accuracy_score` int NOT NULL,
  `high_priority_issues` json NOT NULL,
  `medium_priority_issues` json NOT NULL,
  `low_priority_issues` json NOT NULL,
  `summary` text NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE IF NOT EXISTS `cleaning_rules` (
  `id` int NOT NULL AUTO_INCREMENT,
  `session_id` varchar(64) NOT NULL,
  `run_index` int NOT NULL DEFAULT 1,
  `rule_id` varchar(50) NOT NULL,
  `rule_index` int NOT NULL,
  `name` varchar(255) NOT NULL,
  `field` varchar(255) NOT NULL,
  `action` enum('dedup','fill_null','format','truncate','convert_type','remove','standardize','split','merge') NOT NULL,
  `issue_description` text NULL,
  `strategy` text NULL,
  `affected_rows` int NOT NULL DEFAULT 0,
  `affected_percent` varchar(20) NULL,
  `parameters` json NULL,
  `status` enum('pending','confirmed','skipped') NOT NULL DEFAULT 'pending',
  `preview` json NULL,
  `risk_note` text NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE IF NOT EXISTS `sql_steps` (
  `id` int NOT NULL AUTO_INCREMENT,
  `session_id` varchar(64) NOT NULL,
  `run_index` int NOT NULL DEFAULT 1,
  `step_number` int NOT NULL,
  `name` varchar(255) NOT NULL,
  `operation_type` enum('CREATE','UPDATE','DELETE','INSERT','SELECT') NOT NULL,
  `sql` text NOT NULL,
  `rollback_sql` text NULL,
  `affected_rows` int NOT NULL DEFAULT 0,
  `estimated_time` varchar(50) NULL,
  `risk_level` enum('high','medium','low') NOT NULL DEFAULT 'medium',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE IF NOT EXISTS `execution_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `session_id` varchar(64) NOT NULL,
  `run_index` int NOT NULL DEFAULT 1,
  `execution_id` varchar(64) NOT NULL,
  `overall_status` enum('pending','running','success','failed','partial') NOT NULL,
  `step_results` json NULL,
  `metrics_before` json NULL,
  `metrics_after` json NULL,
  `backup_table_name` varchar(255) NULL,
  `started_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL,
  `error` text NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE IF NOT EXISTS `chat_messages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `session_id` varchar(64) NOT NULL,
  `run_index` int NOT NULL DEFAULT 1,
  `message_id` varchar(64) NOT NULL,
  `role` enum('agent','user','system') NOT NULL,
  `phase` enum('idle','explore','analyze','confirm','generate','execute','retry') NOT NULL DEFAULT 'idle',
  `content` text NOT NULL,
  `metadata` json NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE IF NOT EXISTS `pipeline_snapshots` (
  `id` int NOT NULL AUTO_INCREMENT,
  `session_id` varchar(64) NOT NULL,
  `run_index` int NOT NULL DEFAULT 1,
  `revision_index` int NOT NULL,
  `trigger` varchar(64) DEFAULT NULL,
  `rules` json NOT NULL,
  `generated_sql` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `pipeline_snapshots_session_run_revision` (`session_id`, `run_index`, `revision_index`)
);

CREATE TABLE IF NOT EXISTS `pipeline_runs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `session_id` varchar(64) NOT NULL,
  `run_index` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `pipeline_runs_session_run` (`session_id`, `run_index`)
);

CREATE TABLE IF NOT EXISTS `file_uploads` (
  `id` int NOT NULL AUTO_INCREMENT,
  `session_id` varchar(64) NULL,
  `file_name` varchar(255) NOT NULL,
  `file_size` int NOT NULL,
  `file_type` enum('csv','json','xml','xlsx') NOT NULL,
  `file_path` varchar(500) NOT NULL,
  `encoding` varchar(50) NULL,
  `delimiter` varchar(10) NULL,
  `has_header` int NOT NULL DEFAULT 1,
  `row_count` int NULL,
  `column_count` int NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);
