-- ============================================================================
-- Projetos Dinâmicos — esquema SQLite (v1)
-- Compatível com SQLite 3.34+ (sql.js 1.13 / better-sqlite3)
--
-- Princípios:
--   * minimização de dados (LGPD art. 6º, III)
--   * rastreabilidade completa (LGPD art. 37)
--   * retenção definida por política (LGPD art. 15/16)
--   * auditoria append-only com encadeamento de hashes (à prova de alteração)
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------------------------
-- Metadados e versionamento
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

-- ----------------------------------------------------------------------------
-- Contas e sessões
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'member'
                  CHECK (role IN ('owner','admin','member','viewer')),
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','suspended','deleted')),
  locale          TEXT NOT NULL DEFAULT 'pt-BR',
  timezone        TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  marketing_opt_in INTEGER NOT NULL DEFAULT 0
                  CHECK (marketing_opt_in IN (0,1)),
  is_demo         INTEGER NOT NULL DEFAULT 0
                  CHECK (is_demo IN (0,1)),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  last_login_at   TEXT,
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS ix_users_status ON users(status);
CREATE INDEX IF NOT EXISTS ix_users_role   ON users(role);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  device_label TEXT,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT
);
CREATE INDEX IF NOT EXISTS ix_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS ix_sessions_expires ON sessions(expires_at);

-- ----------------------------------------------------------------------------
-- Consentimentos (LGPD art. 8º e art. 9º)
-- Guardamos cada concessão e cada revogação como eventos imutáveis.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consents (
  id             TEXT PRIMARY KEY,
  user_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  subject_key    TEXT NOT NULL,
  purpose        TEXT NOT NULL
                 CHECK (purpose IN ('termos_de_uso','politica_privacidade','marketing',
                                    'analytics','comunicacoes_projeto','ia_assistente')),
  policy_version TEXT NOT NULL,
  granted        INTEGER NOT NULL CHECK (granted IN (0,1)),
  legal_basis    TEXT NOT NULL
                 CHECK (legal_basis IN ('consentimento','contrato','obrigacao_legal',
                                        'legitimo_interesse','protecao_vida','tutela_saude',
                                        'interesse_publico','exercicio_direitos')),
  source         TEXT NOT NULL DEFAULT 'web',
  created_at     TEXT NOT NULL,
  revoked_at     TEXT
);
CREATE INDEX IF NOT EXISTS ix_consents_subject ON consents(subject_key, purpose);
CREATE INDEX IF NOT EXISTS ix_consents_user    ON consents(user_id);

-- ----------------------------------------------------------------------------
-- Projetos e equipe
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'rascunho'
              CHECK (status IN ('rascunho','em_analise','ativo','pausado','concluido','arquivado')),
  visibility  TEXT NOT NULL DEFAULT 'privado'
              CHECK (visibility IN ('privado','interno','publico')),
  owner_id    TEXT NOT NULL REFERENCES users(id),
  tags        TEXT NOT NULL DEFAULT '[]',
  start_date  TEXT,
  due_date    TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  archived_at TEXT,
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS ix_projects_owner  ON projects(owner_id);
CREATE INDEX IF NOT EXISTS ix_projects_status ON projects(status);

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'colaborador'
             CHECK (role IN ('coordenador','colaborador','observador')),
  invited_by TEXT REFERENCES users(id),
  joined_at  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'ativo'
             CHECK (status IN ('ativo','inativo')),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_members_user ON project_members(user_id);

-- ----------------------------------------------------------------------------
-- Ideias colaborativas
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ideas (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  category   TEXT NOT NULL DEFAULT 'geral'
             CHECK (category IN ('geral','produto','processo','tecnologia','design','pesquisa','comunidade','impacto')),
  status     TEXT NOT NULL DEFAULT 'nova'
             CHECK (status IN ('nova','em_discussao','aprovada','em_execucao','concluida','arquivada')),
  impact     INTEGER NOT NULL DEFAULT 3 CHECK (impact BETWEEN 1 AND 5),
  effort     INTEGER NOT NULL DEFAULT 3 CHECK (effort BETWEEN 1 AND 5),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_ideas_project ON ideas(project_id);
CREATE INDEX IF NOT EXISTS ix_ideas_author  ON ideas(author_id);
CREATE INDEX IF NOT EXISTS ix_ideas_status  ON ideas(status);

CREATE TABLE IF NOT EXISTS idea_votes (
  idea_id    TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value      INTEGER NOT NULL CHECK (value IN (-1,1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (idea_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_votes_user ON idea_votes(user_id);

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  idea_id    TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  parent_id  TEXT REFERENCES comments(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  edited_at  TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_comments_idea   ON comments(idea_id);
CREATE INDEX IF NOT EXISTS ix_comments_author ON comments(author_id);

-- ----------------------------------------------------------------------------
-- Tarefas
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  idea_id     TEXT REFERENCES ideas(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'a_fazer'
              CHECK (status IN ('a_fazer','fazendo','revisao','concluido')),
  priority    TEXT NOT NULL DEFAULT 'media'
              CHECK (priority IN ('baixa','media','alta','critica')),
  assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  due_date    TEXT,
  position    REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS ix_tasks_project  ON tasks(project_id);
CREATE INDEX IF NOT EXISTS ix_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS ix_tasks_status   ON tasks(status);

-- ----------------------------------------------------------------------------
-- Auditoria imutável (LGPD art. 37 — registro das operações de tratamento)
-- Cada linha encadeia o hash da anterior: qualquer alteração quebra a cadeia.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  id              TEXT NOT NULL UNIQUE,
  occurred_at     TEXT NOT NULL,
  actor_id        TEXT,
  actor_label     TEXT NOT NULL,
  actor_role      TEXT,
  action          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       TEXT,
  project_id      TEXT,
  outcome         TEXT NOT NULL DEFAULT 'sucesso'
                  CHECK (outcome IN ('sucesso','falha','negado')),
  legal_basis     TEXT NOT NULL,
  purpose         TEXT NOT NULL,
  data_categories TEXT NOT NULL DEFAULT '[]',
  user_agent      TEXT,
  device_id       TEXT,
  detail          TEXT NOT NULL DEFAULT '{}',
  prev_hash       TEXT NOT NULL,
  hash            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_occurred ON audit_log(occurred_at);
CREATE INDEX IF NOT EXISTS ix_audit_actor    ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS ix_audit_project  ON audit_log(project_id);
CREATE INDEX IF NOT EXISTS ix_audit_action   ON audit_log(action);

CREATE TRIGGER IF NOT EXISTS trg_audit_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log e imutavel (LGPD art. 37)');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log e imutavel (LGPD art. 37)');
END;

-- ----------------------------------------------------------------------------
-- Solicitações de titular (LGPD art. 18/19)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dsr_requests (
  id            TEXT PRIMARY KEY,
  protocol      TEXT NOT NULL UNIQUE,
  subject_key   TEXT NOT NULL,
  subject_email TEXT,
  request_type  TEXT NOT NULL
                CHECK (request_type IN ('acesso','correcao','exclusao','portabilidade',
                                        'revogacao','oposicao','anonimizacao')),
  status        TEXT NOT NULL DEFAULT 'recebida'
                CHECK (status IN ('recebida','em_analise','concluida','recusada')),
  details       TEXT NOT NULL DEFAULT '',
  response      TEXT,
  created_at    TEXT NOT NULL,
  due_at        TEXT NOT NULL,
  completed_at  TEXT,
  handled_by    TEXT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS ix_dsr_status  ON dsr_requests(status);
CREATE INDEX IF NOT EXISTS ix_dsr_subject ON dsr_requests(subject_key);

-- ----------------------------------------------------------------------------
-- Inventário de tratamentos (ROPA — LGPD art. 37 / ANPD Res. CD/ANPD nº 2/2022)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS processing_activities (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  purpose              TEXT NOT NULL,
  legal_basis          TEXT NOT NULL,
  data_categories      TEXT NOT NULL DEFAULT '[]',
  data_subjects        TEXT NOT NULL DEFAULT '',
  retention            TEXT NOT NULL,
  recipients           TEXT NOT NULL DEFAULT '',
  international_transfer INTEGER NOT NULL DEFAULT 0
                       CHECK (international_transfer IN (0,1)),
  security_measures    TEXT NOT NULL DEFAULT '',
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

-- ----------------------------------------------------------------------------
-- Políticas de retenção e descarte
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retention_policies (
  id             TEXT PRIMARY KEY,
  entity         TEXT NOT NULL,
  description    TEXT NOT NULL,
  retention_days INTEGER NOT NULL CHECK (retention_days >= 0),
  action         TEXT NOT NULL CHECK (action IN ('excluir','anonimizar','arquivar')),
  legal_basis    TEXT NOT NULL,
  last_run_at    TEXT
);

-- ----------------------------------------------------------------------------
-- Incidentes de segurança (LGPD art. 48 / Res. CD/ANPD nº 15/2024)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incidents (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  severity          TEXT NOT NULL
                    CHECK (severity IN ('baixa','media','alta','critica')),
  description       TEXT NOT NULL,
  detected_at       TEXT NOT NULL,
  contained_at      TEXT,
  notified_at       TEXT,
  affected_subjects INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'aberto'
                    CHECK (status IN ('aberto','contido','notificado','encerrado')),
  created_by        TEXT REFERENCES users(id),
  created_at        TEXT NOT NULL
);

-- ----------------------------------------------------------------------------
-- Estado de sincronização (opcional, quando há backend instalado)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_state (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  server_url   TEXT,
  last_pull_at TEXT,
  last_push_at TEXT,
  device_id    TEXT
);

-- ----------------------------------------------------------------------------
-- Visões de leitura
-- ----------------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS v_idea_scores AS
SELECT
  i.*,
  COALESCE(SUM(CASE WHEN v.value =  1 THEN 1 ELSE 0 END), 0) AS votes_up,
  COALESCE(SUM(CASE WHEN v.value = -1 THEN 1 ELSE 0 END), 0) AS votes_down,
  COALESCE(SUM(v.value), 0)                                  AS score,
  (SELECT COUNT(*) FROM comments c
    WHERE c.idea_id = i.id AND c.deleted_at IS NULL)         AS comment_count
FROM ideas i
LEFT JOIN idea_votes v ON v.idea_id = i.id
GROUP BY i.id;

CREATE VIEW IF NOT EXISTS v_project_stats AS
SELECT
  p.*,
  (SELECT COUNT(*) FROM project_members m
    WHERE m.project_id = p.id AND m.status = 'ativo')        AS member_count,
  (SELECT COUNT(*) FROM ideas i
    WHERE i.project_id = p.id AND i.deleted_at IS NULL)      AS idea_count,
  (SELECT COUNT(*) FROM ideas i
    WHERE i.project_id = p.id AND i.deleted_at IS NULL
      AND i.status IN ('aprovada','em_execucao'))            AS approved_count,
  (SELECT COUNT(*) FROM tasks t
    WHERE t.project_id = p.id AND t.deleted_at IS NULL)      AS task_count,
  (SELECT COUNT(*) FROM tasks t
    WHERE t.project_id = p.id AND t.deleted_at IS NULL
      AND t.status = 'concluido')                            AS done_count
FROM projects p;
