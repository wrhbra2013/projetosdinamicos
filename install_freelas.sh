#!/bin/sh
set -eu

# ==============================================================
# Script de instalação — API Freelas Projetos Dinâmicos (Docker)
# Uso: sudo bash install_freelas.sh [install|uninstall|logs|reset]
# ==============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { printf "${GREEN}[INFO]${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}[WARN]${NC} %s\n" "$1" >&2; }
error() { printf "${RED}[ERRO]${NC} %s\n" "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || error "Execute como root: sudo bash install_freelas.sh"

# === CONFIGURAÇÃO ===
APP_NAME="freelas"
DB_NAME="${APP_NAME}_db"
APP_PORT=3002
DATA_DIR="/var/www/${APP_NAME}"
ADMIN_EMAIL="admin@projetosdinamicos.com.br"
ADMIN_NOME="admin"
ADMIN_PASS="@admin123"

install_flow() {
  info "==== Instalação da API Freelas Projetos Dinâmicos ===="

  mkdir -p "$DATA_DIR/api/src" "$DATA_DIR/db/init" "$DATA_DIR"/{pgdata,uploads,backups}

  # === docker-compose.yml ===
  info "Gerando docker-compose.yml..."
  cat > "$DATA_DIR/docker-compose.yml" << EOF
services:
  db:
    image: postgres:16-alpine
    container_name: ${APP_NAME}-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: ${DB_NAME}
      ADMIN_EMAIL: ${ADMIN_EMAIL}
      ADMIN_NOME: ${ADMIN_NOME}
      ADMIN_PASS: ${ADMIN_PASS}
    volumes:
      - ${DATA_DIR}/pgdata:/var/lib/postgresql/data
      - ./db/init/01-schema.sql:/docker-entrypoint-initdb.d/01-schema.sql:ro
      - ./db/init/02-seed.sh:/docker-entrypoint-initdb.d/02-seed.sh:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d ${DB_NAME}"]
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    build:
      context: ./api
      dockerfile: Dockerfile
    container_name: ${APP_NAME}-api
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      APP_NAME: ${APP_NAME}
      DB_HOST: db
      DB_PORT: 5432
      DB_NAME: ${DB_NAME}
      DB_USER: postgres
      DB_PASS: postgres
      API_TOKEN: \${API_TOKEN}
    volumes:
      - ${DATA_DIR}/uploads:/app/uploads
      - ${DATA_DIR}/backups:/app/backups
      - ./api/src:/app/src
    ports:
      - "${APP_PORT}:3000"
EOF

  # === api/Dockerfile ===
  info "Gerando api/Dockerfile..."
  cat > "$DATA_DIR/api/Dockerfile" << 'EOF'
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY src/ ./src/
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN mkdir -p /app/uploads /app/backups && chown -R appuser:appgroup /app
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1
CMD ["node", "src/server.js"]
EOF

  # === api/package.json ===
  info "Gerando api/package.json..."
  cat > "$DATA_DIR/api/package.json" << EOF
{
  "name": "${APP_NAME}-api",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.21.0",
    "pg": "^8.12.0"
  }
}
EOF

  # === api/src/server.js (Express dinâmico com CRUD, match, dashboard) ===
  info "Gerando server.js..."
  cat > "$DATA_DIR/api/src/server.js" << 'SERVEREOF'
const { Pool } = require('pg');
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const PROJETO = process.env.APP_NAME || 'freelas';
const API_TOKEN = process.env.API_TOKEN || '';

const pool = new Pool({
    host: process.env.DB_HOST || 'db',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'freelas_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || 'postgres'
});

pool.on('error', (err) => console.error('DB Error:', err));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const corsOptions = {
    origin: [
        'https://www.projetosdinamicos.com.br',
        'https://projetosdinamicos.com.br',
        'https://api.projetosdinamicos.com.br'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};
app.use(cors(corsOptions));

app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.path === '/' || req.path === '/health' || req.path.startsWith('/auth/')) return next();
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ') || auth.slice(7) !== API_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
});

app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

async function tabelaExiste(tabela) {
    const result = await pool.query(
        `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1)`,
        [tabela]
    );
    return result.rows[0].exists;
}

async function garantirColunas(tabela, data) {
    const chaves = Object.keys(data);
    if (chaves.length === 0) return;
    try {
        const result = await pool.query(
            `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
            [tabela]
        );
        const colunasExistentes = new Set(result.rows.map(r => r.column_name));
        const novas = chaves.filter(k => !colunasExistentes.has(k));
        for (const coluna of novas) {
            await pool.query(`ALTER TABLE "${tabela}" ADD COLUMN "${coluna}" TEXT`);
            console.log(`Coluna "${coluna}" criada em "${tabela}"`);
        }
    } catch (err) {
        console.error('Erro ao garantir colunas:', err.message);
    }
}

async function garantirTabela(tabela, data) {
    if (await tabelaExiste(tabela)) return;
    const cols = Object.keys(data)
        .filter(k => k !== 'id')
        .map(k => `"${k}" TEXT`)
        .join(', ');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS "${tabela}" (
            id SERIAL PRIMARY KEY,
            ${cols},
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    console.log(`Tabela "${tabela}" criada dinamicamente`);
}

// === MATCH: encontrar freelancers compatíveis com um projeto ===
async function calcularCompatibilidade(freelancer, requisitos) {
  let score = 0;
  const total = 5;

  // 1. Habilidades (skills)
  if (freelancer.habilidades && requisitos.habilidades) {
    const skillsFreela = freelancer.habilidades.toLowerCase().split(/[,;]+/).map(s => s.trim());
    const skillsReq = requisitos.habilidades.toLowerCase().split(/[,;]+/).map(s => s.trim());
    const match = skillsReq.filter(s => skillsFreela.some(f => f.includes(s) || s.includes(f)));
    if (match.length > 0) score += Math.min(2, match.length);
  }

  // 2. Experiência
  if (freelancer.experiencia && requisitos.experiencia_minima) {
    const expFreela = parseInt(freelancer.experiencia) || 0;
    const expReq = parseInt(requisitos.experiencia_minima) || 0;
    if (expFreela >= expReq) score += 1;
  }

  // 3. Categoria
  if (freelancer.categoria && requisitos.categoria) {
    const catF = freelancer.categoria.toLowerCase();
    const catR = requisitos.categoria.toLowerCase();
    if (catF === catR || catF.includes(catR) || catR.includes(catF)) score += 1;
  }

  // 4. Disponibilidade
  if (freelancer.disponibilidade && requisitos.prazo) {
    score += 0.5;
  }

  // 5. Localização (remoto优先)
  if (requisitos.remoto === 'sim' || freelancer.localizacao === 'remoto') {
    score += 0.5;
  }

  return Math.round((score / total) * 100);
}

// === Health ===
app.get('/', (req, res) => {
    res.json({
        message: 'API Freelas Projetos Dinâmicos',
        status: 'OK',
        project: PROJETO,
        timestamp: new Date().toISOString()
    });
});

app.get('/health', async (req, res) => {
    const base = { status: 'healthy', project: PROJETO, timestamp: new Date().toISOString() };
    try {
        await pool.query('SELECT 1');
        res.json({ ...base, database: 'connected' });
    } catch (err) {
        res.json({ ...base, status: 'unhealthy', database: 'disconnected', error: err.message });
    }
});

// === Auth ===
app.post('/auth/login', async (req, res) => {
    const { usuario, email, nome, senha } = req.body;
    const loginId = usuario || email || nome;
    if (!loginId || !senha) {
        return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
    }
    try {
        const result = await pool.query(
            'SELECT id, usuario, isadmin FROM login WHERE usuario = $1 AND senha = $2',
            [loginId, senha]
        );
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Usuário ou senha inválidos' });
        }
        const user = result.rows[0];
        res.json({ success: true, token: API_TOKEN, usuario: user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Search ===
app.get('/search', async (req, res) => {
    const { q } = req.query;
    if (!q || q.length < 2) {
        return res.json({ results: [] });
    }
    try {
        const term = '%' + q.toLowerCase() + '%';
        const results = [];
        const queries = [];

        const searchTables = ['projetos', 'freelancers', 'clientes', 'eventos', 'parceria', 'recursos'];
        for (const tabela of searchTables) {
            if (await tabelaExiste(tabela)) {
                const colInfo = await pool.query(
                    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND data_type = 'text'`,
                    [tabela]
                );
                const textCols = colInfo.rows.map(r => r.column_name).filter(c => c !== 'id' && c !== 'foto_url' && c !== 'arquivo');
                if (textCols.length > 0) {
                    const firstCol = textCols[0];
                    const conditions = textCols.map(c => `LOWER(COALESCE("${c}",'')) LIKE $1`).join(' OR ');
                    queries.push(
                        pool.query(
                            `SELECT id, "${firstCol}" as titulo, LEFT(COALESCE(${textCols.slice(1,3).map(c => `"${c}"`).join(',' || "''"),}),100) as descricao, '${tabela}' as tabela FROM "${tabela}" WHERE ${conditions} LIMIT 5`,
                            [term]
                        ).then(r => results.push(...r.rows)).catch(() => {})
                    );
                }
            }
        }

        await Promise.all(queries);
        res.json({ results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Dashboard: stats gerais ===
app.get('/dashboard', async (req, res) => {
  try {
    const tables = ['projetos', 'freelancers', 'clientes', 'propostas'];
    const stats = {};
    for (const t of tables) {
      if (await tabelaExiste(t)) {
        const r = await pool.query(`SELECT COUNT(*) as count FROM "${t}"`);
        stats[t] = parseInt(r.rows[0].count);
      } else {
        stats[t] = 0;
      }
    }
    // Projetos por status
    if (await tabelaExiste('projetos')) {
      const r = await pool.query(`SELECT status, COUNT(*) as count FROM projetos GROUP BY status`);
      stats.projetos_por_status = r.rows;
    }
    // Freelancers por categoria
    if (await tabelaExiste('freelancers')) {
      const r = await pool.query(`SELECT categoria, COUNT(*) as count FROM freelancers GROUP BY categoria`);
      stats.freelancers_por_categoria = r.rows;
    }
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === MATCH: compatibilidade entre freelancers e projetos ===
app.get('/match/:projetoId', async (req, res) => {
  const { projetoId } = req.params;
  try {
    if (!(await tabelaExiste('projetos')) || !(await tabelaExiste('freelancers'))) {
      return res.json({ matches: [] });
    }
    const proj = await pool.query('SELECT * FROM projetos WHERE id = $1', [projetoId]);
    if (proj.rows.length === 0) return res.status(404).json({ error: 'Projeto não encontrado' });
    const projeto = proj.rows[0];

    const freelas = await pool.query('SELECT * FROM freelancers ORDER BY created_at DESC LIMIT 200');
    const matches = [];

    for (const freelancer of freelas.rows) {
      const compat = await calcularCompatibilidade(freelancer, projeto);
      if (compat >= 40) {
        matches.push({
          freelancer,
          compatibilidade: compat,
          destaque: compat >= 80
        });
      }
    }

    matches.sort((a, b) => b.compatibilidade - a.compatibilidade);
    res.json({ projeto, matches, total: matches.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === CRUD Dinâmico ===
app.get('/:tabela', async (req, res) => {
    const { tabela } = req.params;
    if (!(await tabelaExiste(tabela))) {
        return res.status(404).json({ error: 'Tabela não encontrada' });
    }
    try {
        const result = await pool.query(`SELECT * FROM "${tabela}" ORDER BY id DESC LIMIT 500`);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/:tabela', async (req, res) => {
    const { tabela } = req.params;
    const data = req.body;
    try {
        await garantirTabela(tabela, data);
        await garantirColunas(tabela, data);
        const keys = Object.keys(data).map(k => `"${k}"`).join(', ');
        const values = Object.keys(data).map((_, i) => `$${i + 1}`).join(', ');
        const result = await pool.query(
            `INSERT INTO "${tabela}" (${keys}) VALUES (${values}) RETURNING *;`,
            Object.values(data)
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/:tabela/:id', async (req, res) => {
    const { tabela, id } = req.params;
    if (!(await tabelaExiste(tabela))) {
        return res.status(404).json({ error: 'Tabela não encontrada' });
    }
    const data = req.body;
    try {
        await garantirColunas(tabela, data);
        const keys = Object.keys(data).map((k, i) => `"${k}" = $${i + 1}`).join(', ');
        const result = await pool.query(
            `UPDATE "${tabela}" SET ${keys} WHERE id = $${Object.keys(data).length + 1} RETURNING *;`,
            [...Object.values(data), id]
        );
        res.json(result.rows[0] || { error: 'Registro não encontrado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/:tabela/:id', async (req, res) => {
    const { tabela, id } = req.params;
    if (!(await tabelaExiste(tabela))) {
        return res.status(404).json({ error: 'Tabela não encontrada' });
    }
    try {
        await pool.query(`DELETE FROM "${tabela}" WHERE id = $1`, [id]);
        res.json({ success: true, message: 'Registro excluído' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Freelas API running on port ${PORT}`);
});
SERVEREOF

  # === db/init/01-schema.sql (Freelas) ===
  info "Gerando schema do banco (Freelas)..."
  cat > "$DATA_DIR/db/init/01-schema.sql" << 'EOSQL'
CREATE TABLE IF NOT EXISTS settings (
    chave VARCHAR(100) PRIMARY KEY,
    valor TEXT
);

CREATE TABLE IF NOT EXISTS login (
    id SERIAL PRIMARY KEY,
    usuario VARCHAR(255) NOT NULL UNIQUE,
    senha VARCHAR(255) NOT NULL,
    isadmin BOOLEAN DEFAULT false,
    origem TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Freelancers (profissionais de TI)
CREATE TABLE IF NOT EXISTS freelancers (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    telefone VARCHAR(50),
    categoria VARCHAR(100),
    habilidades TEXT,
    experiencia VARCHAR(10),
    portfolio TEXT,
    linkedin VARCHAR(255),
    github VARCHAR(255),
    disponibilidade VARCHAR(50),
    localizacao VARCHAR(100),
    preco_hora VARCHAR(50),
    bio TEXT,
    foto_url TEXT,
    destaque BOOLEAN DEFAULT false,
    status VARCHAR(50) DEFAULT 'disponivel',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Clientes (contratantes)
CREATE TABLE IF NOT EXISTS clientes (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    empresa VARCHAR(255),
    email VARCHAR(255) NOT NULL,
    telefone VARCHAR(50),
    cnpj VARCHAR(50),
    site VARCHAR(255),
    descricao TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Projetos (vagas para freelancers)
CREATE TABLE IF NOT EXISTS projetos (
    id SERIAL PRIMARY KEY,
    titulo VARCHAR(255) NOT NULL,
    descricao TEXT,
    categoria VARCHAR(100),
    habilidades TEXT,
    experiencia_minima VARCHAR(10),
    prazo VARCHAR(100),
    valor VARCHAR(100),
    remoto VARCHAR(20) DEFAULT 'sim',
    localizacao VARCHAR(100),
    status VARCHAR(50) DEFAULT 'aberto',
    cliente_id INTEGER,
    destaque BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Propostas (candidaturas de freelancers a projetos)
CREATE TABLE IF NOT EXISTS propostas (
    id SERIAL PRIMARY KEY,
    projeto_id INTEGER,
    freelancer_id INTEGER,
    valor_proposto VARCHAR(100),
    prazo_proposto VARCHAR(100),
    mensagem TEXT,
    compatibilidade INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'pendente',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Planos (modelos de assinatura/anúncio)
CREATE TABLE IF NOT EXISTS planos (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    descricao TEXT,
    preco VARCHAR(50),
    recursos TEXT,
    tipo VARCHAR(50),
    destaque BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Anúncios (pagos por anunciantes)
CREATE TABLE IF NOT EXISTS anuncios (
    id SERIAL PRIMARY KEY,
    titulo VARCHAR(255) NOT NULL,
    descricao TEXT,
    imagem TEXT,
    link TEXT,
    tipo VARCHAR(50),
    status VARCHAR(50) DEFAULT 'ativo',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Garantias (registro de garantia de tarefas)
CREATE TABLE IF NOT EXISTS garantias (
    id SERIAL PRIMARY KEY,
    proposta_id INTEGER,
    freelancer_id INTEGER,
    projeto_id INTEGER,
    valor_garantia VARCHAR(100),
    prazo_limite VARCHAR(100),
    status VARCHAR(50) DEFAULT 'ativa',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Eventos
CREATE TABLE IF NOT EXISTS eventos (
    id SERIAL PRIMARY KEY,
    titulo VARCHAR(255) NOT NULL,
    descricao TEXT,
    tipo VARCHAR(100),
    data_evento VARCHAR(50),
    hora VARCHAR(50),
    local VARCHAR(255),
    link_inscricao TEXT,
    destaque BOOLEAN DEFAULT false,
    status VARCHAR(50) DEFAULT 'agendado',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Recursos
CREATE TABLE IF NOT EXISTS recursos (
    id SERIAL PRIMARY KEY,
    titulo VARCHAR(255) NOT NULL,
    descricao TEXT,
    tipo VARCHAR(100),
    categoria VARCHAR(100),
    arquivo TEXT,
    link TEXT,
    icone VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Parcerias
CREATE TABLE IF NOT EXISTS parceria (
    id SERIAL PRIMARY KEY,
    empresa VARCHAR(255) NOT NULL,
    localidade VARCHAR(255),
    proposta TEXT,
    representante VARCHAR(255) NOT NULL,
    telefone VARCHAR(50),
    email VARCHAR(255),
    tipo VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Contatos
CREATE TABLE IF NOT EXISTS contatos (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    assunto VARCHAR(255),
    mensagem TEXT,
    lido BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
);
EOSQL

  # === db/init/02-seed.sh ===
  info "Gerando seed..."
  cat > "$DATA_DIR/db/init/02-seed.sh" << EOF
#!/bin/bash
set -e
psql -v ON_ERROR_STOP=1 --username "\$POSTGRES_USER" --dbname "\$POSTGRES_DB" <<-EOSQL
    INSERT INTO login (usuario, senha, isadmin)
    VALUES ('${ADMIN_EMAIL}', '${ADMIN_PASS}', true)
    ON CONFLICT (usuario) DO NOTHING;

    INSERT INTO planos (nome, descricao, preco, recursos, tipo, destaque) VALUES
    ('Gratuito', 'Perfil básico e candidatura a projetos', 'Grátis', '["Perfil público","Candidatura a projetos","Acesso ao dashboard"]', 'freelancer', false),
    ('Profissional', 'Perfil destacado e matching prioritário', 'R$ 29,90/mês', '["Perfil destacado","Matching inteligente","Suporte prioritário","Relatórios"]', 'freelancer', true),
    ('Premium', 'Máxima visibilidade e benefícios exclusivos', 'R$ 59,90/mês', '["Perfil VIP","Matching exclusivo","Garantia de tarefas","Suporte 24/7","Certificações"]', 'freelancer', false),
    ('Anúncio Básico', 'Divulgue seu projeto para nossa rede', 'Grátis', '["Projeto listado","Candidatura de freelancers"]', 'cliente', false),
    ('Anúncio Destacado', 'Projeto em destaque no topo das buscas', 'R$ 49,90', '["Projeto destacado","Matching automático","Relatório de candidatos","Suporte"]', 'cliente', true)
    ON CONFLICT DO NOTHING;

    INSERT INTO anuncios (titulo, descricao, tipo, status) VALUES
    ('Banner Principal', 'Espaço publicitário no topo da plataforma', 'banner', 'ativo'),
    ('Sidebar', 'Anúncio lateral nas páginas internas', 'sidebar', 'ativo')
    ON CONFLICT DO NOTHING;
EOSQL
EOF
  chmod +x "$DATA_DIR/db/init/02-seed.sh"

  # === API_TOKEN ===
  API_TOKEN=$(openssl rand -hex 32)

  # === .env ===
  info "Criando .env..."
  cat > "$DATA_DIR/.env" << EOF
PORT=${APP_PORT}
APP_NAME=${APP_NAME}
DATA_DIR=${DATA_DIR}
DB_HOST=db
DB_PORT=5432
DB_NAME=${DB_NAME}
DB_USER=postgres
DB_PASS=postgres
API_TOKEN=${API_TOKEN}
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_NOME=${ADMIN_NOME}
ADMIN_PASS=${ADMIN_PASS}
EOF

  cat > "$SCRIPT_DIR/.env" << EOF
APP_NAME=${APP_NAME}
DATA_DIR=${DATA_DIR}
EOF

  # === static/js/api_token.js ===
  mkdir -p "$DATA_DIR/static/js"
  cat > "$DATA_DIR/static/js/api_token.js" << EOF
window.API_TOKEN = '${API_TOKEN}';
EOF

  # === Build containers ===
  info "Construindo containers..."
  docker compose -f "$DATA_DIR/docker-compose.yml" down 2>/dev/null || true
  docker compose -f "$DATA_DIR/docker-compose.yml" up -d --build || {
    error "Falha ao construir containers"
    exit 1
  }

  # === Nginx ===
  NGINX_LOCATIONS="/etc/nginx/${APP_NAME}-locations.conf"
  cat > "$NGINX_LOCATIONS" << EOF
location /${APP_NAME}/ {
    rewrite ^/${APP_NAME}/(.*) /\$1 break;
    proxy_pass http://127.0.0.1:${APP_PORT}/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
}
EOF

  NGINX_CONF="/etc/nginx/sites-available/default"
  if [ -f "$NGINX_CONF" ] && ! grep -q "${APP_NAME}-locations.conf" "$NGINX_CONF"; then
    sed -i "/server_name api\.projetosdinamicos\.com\.br;/a\    include ${NGINX_LOCATIONS};" "$NGINX_CONF" 2>/dev/null || true
  fi
  nginx -t 2>/dev/null && systemctl reload nginx.service 2>/dev/null || true

  echo ""
  info "===== Instalação concluída! ====="
  echo ""
  echo "  Projeto:   ${APP_NAME}"
  echo "  API:       http://localhost:${APP_PORT}"
  echo "  Health:    http://localhost:${APP_PORT}/health"
  echo "  Publica:   https://api.projetosdinamicos.com.br/${APP_NAME}/"
  echo "  Dashboard: https://api.projetosdinamicos.com.br/${APP_NAME}/dashboard"
  echo "  Match:     https://api.projetosdinamicos.com.br/${APP_NAME}/match/:id"
  echo "  Admin:     ${ADMIN_EMAIL} / ${ADMIN_PASS}"
  echo ""
  echo "  Token:    ${API_TOKEN}"
  echo ""
  echo "  Próximo passo: atualize static/js/api.js com o novo token:"
  echo "  window.API_BASE = 'https://api.projetosdinamicos.com.br/${APP_NAME}';"
  echo ""
}

case "${1:-install}" in
  install|"") install_flow ;;
  uninstall)
    echo "Desinstalação..."
    docker compose -f "${DATA_DIR}/docker-compose.yml" down 2>/dev/null || true
    rm -rf "${DATA_DIR}"
    rm -f "/etc/nginx/${APP_NAME}-locations.conf"
    nginx -t 2>/dev/null && systemctl reload nginx.service 2>/dev/null || true
    echo "Removido."
    ;;
  logs)
    docker logs "${APP_NAME}-api" --tail 30 2>&1 || echo "Container não encontrado"
    ;;
  reset)
    docker compose -f "${DATA_DIR}/docker-compose.yml" down -v 2>/dev/null || true
    rm -rf "${DATA_DIR}/pgdata"
    install_flow
    ;;
  *) error "Uso: $0 {install|uninstall|logs|reset}" ;;
esac
