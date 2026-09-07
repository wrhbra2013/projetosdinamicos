#!/bin/sh
set -eu

# ==============================================================
# Script de instalação — KitNet 3D API (Docker)
# Uso: sudo bash install_kitnet3d.sh          (instalar)
#       sudo bash install_kitnet3d.sh uninstall (desinstalar)
#       sudo bash install_kitnet3d.sh reconfig  (alterar porta)
#
# API REST com Fastify + SQLite (node:sqlite built-in) em container Docker.
# Requer: Debian 11+ (sudo apt para dependências) — Magalu Cloud
# ==============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="/var/www/kitnet3d"
SRC_DIR="$INSTALL_DIR/api/src"
NGINX_CONF="/etc/nginx/sites-available/default"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { printf "${GREEN}[INFO]${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}[WARN]${NC} %s\n" "$1" >&2; }
error() { printf "${RED}[ERRO]${NC} %s\n" "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || error "Execute como root: sudo bash install_kitnet3d.sh"


# ==============================================================
# Uninstall
# ==============================================================
uninstall() {
  echo ""
  info "===== Iniciando desinstalação da API KitNet 3D (Docker) ====="

  echo ""

  [ -f "$INSTALL_DIR/.env" ] && . "$INSTALL_DIR/.env" || true

  dname="${COMPOSE_PROJECT_NAME:-kitnet3d}"

  _dc_cmd="docker compose"
  docker compose version >/dev/null 2>&1 || _dc_cmd="docker-compose"

  echo ""
  info "[1/4] Parando e removendo containers Docker ($dname)..."
  if [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
    $_dc_cmd -f "$INSTALL_DIR/docker-compose.yml" down -v --rmi local 2>/dev/null && \
      info "Containers, volumes e imagens do projeto removidos" || \
      warn "Falha ao derrubar containers"
  else
    warn "docker-compose.yml não encontrado"
  fi

  echo ""
  info "[2/4] Removendo configuracao nginx..."
  NGINX_LOCATIONS="/etc/nginx/${dname}-locations.conf"
  rm -f "$NGINX_LOCATIONS" && info "${NGINX_LOCATIONS} removido" || warn "Falha ao remover ${NGINX_LOCATIONS}"
  sed -i "/${dname}-locations.conf/d" "$NGINX_CONF" 2>/dev/null || true
  sed -i "/# BEGIN ${dname}_site/,/# END ${dname}_site/d" "$NGINX_CONF" 2>/dev/null || true
  if nginx -t 2>/dev/null; then
    systemctl reload nginx.service 2>/dev/null && info "Nginx recarregado" || warn "Falha ao recarregar nginx"
  else
    warn "Configuração do nginx inválida — verifique manualmente"
  fi

  echo ""
  info "[3/4] Removendo imagens Docker do projeto..."
  dimg=$(printf '%s' "$dname" | tr '[:upper:]' '[:lower:]')
  for img in "${dimg}-api:latest" "${dimg}_api:latest"; do
    docker images -q "$img" 2>/dev/null | xargs -r docker rmi -f 2>/dev/null || true
  done
  [ -z "$(docker images -q "${dimg}-api:latest" "${dimg}_api:latest" 2>/dev/null)" ] && \
    info "Imagens Docker do projeto removidas" || warn "Falha ao remover algumas imagens"

  echo ""
  info "[4/4] Removendo diretório $INSTALL_DIR..."
  rm -rf "$INSTALL_DIR" && info "Diretório $INSTALL_DIR removido com sucesso" || warn "Falha ao remover diretório $INSTALL_DIR"

  echo ""
  info "Desinstalação concluída!"
}

case "${1:-}" in
  uninstall) uninstall; exit 0 ;;
esac

echo ""
info "===== Iniciando instalação da API KitNet 3D (Docker) ====="
echo ""


# --------------------------------------------------------------
# Checagem de dependências — Debian 11+ (Magalu Cloud)
# --------------------------------------------------------------
info "===== Verificando dependências do servidor ====="

# Função auxiliar para detectar gerenciador de pacotes
_apt_update_done=0
_apt_update() {
  if [ "$_apt_update_done" -eq 0 ]; then
    info "Executando apt-get update..."
    apt-get update -qq || error "Falha ao executar apt-get update"
    _apt_update_done=1
  fi
}

# Verificar Debian/Ubuntu
if [ ! -f /etc/debian_version ]; then
  error "Este script requer Debian 11+ ou Ubuntu. /etc/debian_version não encontrado."
fi
DEB_VER=$(cat /etc/debian_version 2>/dev/null || echo "desconhecido")
info "Sistema: Debian $DEB_VER"

# Verificar root
[ "$(id -u)" -eq 0 ] || error "Execute como root: sudo bash install_kitnet3d.sh"

# curl — necessário para download e healthcheck
if ! command -v curl >/dev/null 2>&1; then
  warn "curl não encontrado — instalando..."
  _apt_update && apt-get install -y -qq curl
  command -v curl >/dev/null 2>&1 && info "curl instalado" || error "Falha ao instalar curl"
else
  info "curl: $(curl --version 2>&1 | head -1)"
fi

# openssl — necessário para gerar JWT_SECRET
if ! command -v openssl >/dev/null 2>&1; then
  warn "openssl não encontrado — instalando..."
  _apt_update && apt-get install -y -qq openssl
  command -v openssl >/dev/null 2>&1 && info "openssl instalado" || error "Falha ao instalar openssl"
else
  info "openssl: $(openssl version 2>&1)"
fi

# ss ou lsof — necessário para verificar portas
if ! command -v ss >/dev/null 2>&1 && ! command -v lsof >/dev/null 2>&1; then
  warn "ss/lsof não encontrado — instalando iproute2..."
  _apt_update && apt-get install -y -qq iproute2
  command -v ss >/dev/null 2>&1 && info "ss instalado" || warn "ss não disponível — verificação de portas limitada"
else
  info "ss/lsof: disponível"
fi

# fuser — necessário para liberar portas
if ! command -v fuser >/dev/null 2>&1; then
  warn "fuser não encontrado — instalando psmisc..."
  _apt_update && apt-get install -y -qq psmisc
  command -v fuser >/dev/null 2>&1 && info "fuser instalado" || warn "fuser não disponível"
fi


# --------------------------------------------------------------
# Docker Engine — instala via apt se não existir
# --------------------------------------------------------------
info "Verificando Docker Engine..."
if ! command -v docker >/dev/null 2>&1; then
  warn "Docker não encontrado — instalando docker.io via apt..."
  _apt_update && apt-get install -y -qq docker.io
  systemctl enable --now docker
  sleep 2
  if docker --version >/dev/null 2>&1; then
    info "Docker instalado: $(docker --version)"
  else
    error "Falha ao instalar Docker Engine"
  fi
else
  info "Docker: $(docker --version 2>&1)"
fi

# Verificar se Docker daemon está rodando
if ! docker info >/dev/null 2>&1; then
  warn "Docker daemon não está rodando — tentando iniciar..."
  systemctl start docker 2>/dev/null || service docker start 2>/dev/null
  sleep 3
  docker info >/dev/null 2>&1 || error "Docker daemon não está rodando. Verifique: systemctl status docker"
fi
info "Docker daemon: ativo"


# --------------------------------------------------------------
# Docker Compose — plugin ou standalone
# --------------------------------------------------------------
info "Verificando Docker Compose..."
DOCKER_COMPOSE_CMD=""
if docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE_CMD="docker compose"
  info "Docker Compose (plugin): $(docker compose version --short 2>/dev/null || echo 'ok')"
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE_CMD="docker-compose"
  info "Docker Compose (standalone): $(docker-compose --version 2>&1)"
else
  warn "Docker Compose não encontrado — instalando plugin..."
  _apt_update && apt-get install -y -qq docker-compose-plugin 2>/dev/null || \
    apt-get install -y -qq docker-compose 2>/dev/null || {
      # Fallback: instalar standalone via curl
      warn "apt falhou — instalando docker-compose standalone via curl..."
      COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep tag_name | cut -d '"' -f 4)
      curl -L "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" \
        -o /usr/local/bin/docker-compose
      chmod +x /usr/local/bin/docker-compose
    }
  if docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE_CMD="docker compose"
    info "Docker Compose (plugin) instalado: $(docker compose version --short 2>/dev/null || echo 'ok')"
  elif docker-compose --version >/dev/null 2>&1; then
    DOCKER_COMPOSE_CMD="docker-compose"
    info "Docker Compose (standalone) instalado: $(docker-compose --version 2>&1)"
  else
    error "Falha ao instalar Docker Compose — instale manualmente"
  fi
fi


# --------------------------------------------------------------
# Nginx
# --------------------------------------------------------------
info "Verificando Nginx..."
if ! command -v nginx >/dev/null 2>&1; then
  warn "Nginx não encontrado — instalando..."
  _apt_update && apt-get install -y -qq nginx
  systemctl enable nginx 2>/dev/null || true
  systemctl start nginx 2>/dev/null || true
  command -v nginx >/dev/null 2>&1 && info "Nginx instalado" || error "Falha ao instalar Nginx"
else
  info "Nginx: $(nginx -v 2>&1)"
fi


# --------------------------------------------------------------
# Resumo das dependências
# --------------------------------------------------------------
info "===== Resumo das dependências ====="
info "  Docker:         $(docker --version 2>&1 | awk '{print $3}' | tr -d ',')"
info "  Docker Compose: $($DOCKER_COMPOSE_CMD version --short 2>/dev/null || $DOCKER_COMPOSE_CMD --version 2>&1 | awk '{print $NF}')"
info "  Nginx:          $(nginx -v 2>&1 | awk -F/ '{print $2}')"
info "  curl:           $(curl --version 2>&1 | head -1 | awk '{print $2}')"
info "  openssl:        $(openssl version 2>&1 | awk '{print $2}')"
info "===================================="


# --------------------------------------------------------------
# Inputs do usuário
# --------------------------------------------------------------
echo "============ Configuração da instalação ============"

_check_port() {
  local p=$1
  if command -v ss >/dev/null 2>&1; then
    ss -tlnp "sport = :$p" 2>/dev/null | grep -qv 'State.*Recv-Q' && return 0
  elif command -v lsof >/dev/null 2>&1; then
    lsof -i:"$p" 2>/dev/null | grep -q LISTEN && return 0
  fi
  return 1
}

info "Como consultar portas em uso e livres no Debian:"
echo "    Portas EM USO :  ss -tulpn | grep LISTEN"
echo "                     sudo lsof -iTCP -sTCP:LISTEN -n -P"
echo "    Rang LIVE     :  for p in \$(seq 3000 3010); do ss -tln | grep -q \":\$p \" || echo \"\$p livre\"; done"
echo ""

while :; do
  printf "Porta do app (host) [3002]: "; read -r APP_PORT
  APP_PORT=${APP_PORT:-3002}
  if _check_port "$APP_PORT"; then
    warn "Porta $APP_PORT já está em uso!"
    printf "  (M)atar processo, (T)rocar porta, (C)ancelar [M/t/c]: "; read -r PORT_ACT
    case "$PORT_ACT" in
      [Tt]) continue ;;
      [Cc]) error "Instalação cancelada pelo usuário" ;;
      *)
        fuser -k "$APP_PORT/tcp" 2>/dev/null && info "Processo na porta $APP_PORT encerrado" || warn "Não foi possível encerrar — tente trocar a porta"
        sleep 1
        ;;
    esac
  fi
  break
done
info "Porta definida: $APP_PORT"

printf "Nome do projeto Docker/compose [kitnet3d]: "; read -r COMPOSE_PROJECT_NAME
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-kitnet3d}; info "COMPOSE_PROJECT_NAME: $COMPOSE_PROJECT_NAME"
APP_DOMAIN=api.projetosdinamicos.com.br


# --------------------------------------------------------------
# Criar diretórios e copiar projeto
# --------------------------------------------------------------
info "Criando diretórios..."
mkdir -p "$SRC_DIR" && info "Diretórios criados: $SRC_DIR" || warn "Erro ao criar diretórios"

DATA_DIR="$INSTALL_DIR/data"
mkdir -p "$DATA_DIR" && info "Diretório de dados criado: $DATA_DIR" || warn "Erro ao criar diretório de dados"

# Copiar front estático (se presente junto ao script)
if [ -f "$SCRIPT_DIR/index.html" ]; then
  cp "$SCRIPT_DIR/index.html" "$INSTALL_DIR/index.html" && info "index.html copiado" || warn "Falha ao copiar index.html"
  cp "$SCRIPT_DIR/main.js" "$INSTALL_DIR/main.js" && info "main.js copiado" || warn "Falha ao copiar main.js"
else
  warn "index.html não encontrado em $SCRIPT_DIR — a API rodará sem o front (só endpoints REST)"
fi


# --------------------------------------------------------------
# .env  (usado pelo docker-compose e pelo container)
# --------------------------------------------------------------
JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || echo "$(date +%s)$RANDOM" | md5sum | head -c 64)
info "Criando .env (PORT=$APP_PORT, JWT_SECRET gerado)"
cat > "$INSTALL_DIR/.env" <<ENVEOF
# App
PORT=$APP_PORT
JWT_SECRET=$JWT_SECRET
COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME

# Banco de dados SQLite (arquivo dentro do volume /data)
DB_PATH=/data/kitnet3d.db

# CORS: domínios que podem chamar a API (separados por vírgula)
CORS_ORIGIN=https://www.projetosdinamicos.com.br

# Mercado Pago (opcional) — access token de produção para validar pagamentos
MP_ACCESS_TOKEN=
ENVEOF
chmod 600 "$INSTALL_DIR/.env" && info "Permissões do .env ajustadas (600)" || warn "Falha ao ajustar permissões"


# --------------------------------------------------------------
# package.json
# --------------------------------------------------------------
info "Criando package.json"
cat > "$INSTALL_DIR/api/package.json" <<'JSONEOF'
{
  "name": "kitnet3d-api",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "dependencies": {
    "@fastify/cors": "^9.0.0",
    "@fastify/rate-limit": "^9.0.0",
    "@fastify/static": "^7.0.0",
    "bcryptjs": "^2.4.3",
    "dotenv": "^16.4.0",
    "fastify": "^4.28.0",
    "jsonwebtoken": "^9.0.2"
  }
}
JSONEOF


# --------------------------------------------------------------
# src/server.js
# --------------------------------------------------------------
info "Criando src/server.js"
cat > "$SRC_DIR/server.js" <<'SVREOF'
/* =========================================================================
   KitNet 3D — API (assistente de arquiteto)
   Fastify + node:sqlite (built-in) — Docker
   ========================================================================= */

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { DatabaseSync } from 'node:sqlite';
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const fastify = Fastify({ logger: true });

const DB_PATH = process.env.DB_PATH || path.join(PROJECT_ROOT, 'data', 'kitnet3d.db');
const CORS_ORIGIN = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true;
const JWT_SECRET = process.env.JWT_SECRET;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';

if (!JWT_SECRET) {
  console.error('ERRO: JWT_SECRET nao definido. Defina via .env.');
  process.exit(1);
}

/* ------------------------------- banco -------------------------------- */
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  senha_hash TEXT NOT NULL,
  nome TEXT DEFAULT '',
  plano TEXT DEFAULT 'free',
  plano_expira TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS projetos (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL,
  nome TEXT DEFAULT 'Sem nome',
  conteudo TEXT DEFAULT '{}',
  compartilhar_token TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS pagamentos (
  id TEXT PRIMARY KEY,
  usuario_id TEXT,
  payment_id TEXT UNIQUE,
  plano TEXT,
  valor REAL,
  status TEXT,
  webhook_body TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

const PLANOS = { avulso: { dias: 1 }, essencial: { dias: 30 }, pro: { dias: 30 } };
const limPlanos = { free: 1, avulso: 3, essencial: 10, pro: 999 };

function novoTimestampDias(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString();
}

function planoValido(u) {
  if (!u) return 'free';
  if (u.plano === 'free') return 'free';
  if (u.plano_expira && new Date(u.plano_expira) < new Date()) return 'free';
  return u.plano;
}

/* --------------------------- middlewares auth -------------------------- */
function authMiddleware(req, reply, done) {
  const h = req.headers.authorization || '';
  const token = h.replace('Bearer ', '');
  if (!token) { reply.code(401).send({ error: 'Não autenticado' }); return; }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const usr = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(payload.sub);
    if (!usr) { reply.code(401).send({ error: 'Usuário não encontrado' }); return; }
    req.usuario = usr;
    done();
  } catch (e) {
    reply.code(401).send({ error: 'Sessão inválida ou expirada' });
  }
}

function isValidId(id) {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

/* ------------------------------- plugins -------------------------------- */
await fastify.register(cors, { origin: CORS_ORIGIN, methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] });
await fastify.register(rateLimit, { max: 200, timeWindow: '1 minute' });

fastify.get('/health', async () => {
  let dbOk = 'error';
  try { db.prepare('SELECT 1').get(); dbOk = 'ok'; } catch (e) { /* noop */ }
  return { status: 'ok', db: dbOk, timestamp: new Date().toISOString() };
});
fastify.get('/ping', async () => ({ pong: true }));

/* ---------------------------- autenticação ----------------------------- */
fastify.post('/api/register', async (req, reply) => {
  const { email, senha, nome } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply.code(400).send({ error: 'Email inválido' });
  if (!senha || senha.length < 6) return reply.code(400).send({ error: 'Senha deve ter pelo menos 6 caracteres' });
  const exists = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email.toLowerCase());
  if (exists) return reply.code(409).send({ error: 'Email já cadastrado' });
  const id = crypto.randomUUID();
  const senha_hash = bcrypt.hashSync(senha, 10);
  db.prepare('INSERT INTO usuarios (id, email, senha_hash, nome, plano) VALUES (?, ?, ?, ?, ?)').run(id, email.toLowerCase(), senha_hash, nome || '', 'free');
  const token = jwt.sign({ sub: id }, JWT_SECRET, { expiresIn: '30d' });
  return { success: true, token, usuario: { id, email, nome: nome || '', plano: 'free' } };
});

fastify.post('/api/login', async (req, reply) => {
  const { email, senha } = req.body || {};
  if (!email || !senha) return reply.code(400).send({ error: 'Informe email e senha' });
  const usr = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email.toLowerCase());
  if (!usr || !bcrypt.compareSync(senha, usr.senha_hash)) return reply.code(401).send({ error: 'Credenciais inválidas' });
  const token = jwt.sign({ sub: usr.id }, JWT_SECRET, { expiresIn: '30d' });
  return { success: true, token, usuario: { id: usr.id, email: usr.email, nome: usr.nome, plano: planoValido(usr), plano_expira: usr.plano_expira } };
});

fastify.get('/api/me', { preHandler: authMiddleware }, async (req) => {
  const u = req.usuario;
  return { success: true, usuario: { id: u.id, email: u.email, nome: u.nome, plano: planoValido(u), plano_expira: u.plano_expira } };
});

fastify.put('/api/me', { preHandler: authMiddleware }, async (req, reply) => {
  const { nome } = req.body || {};
  if (nome == null) return reply.code(400).send({ error: 'Informe nome' });
  db.prepare('UPDATE usuarios SET nome = ? WHERE id = ?').run(String(nome), req.usuario.id);
  return { success: true };
});

/* --------------------------- projetos (CRUD) --------------------------- */
fastify.get('/api/projetos', { preHandler: authMiddleware }, async (req) => {
  const rows = db.prepare('SELECT id, nome, compartilhar_token, created_at, updated_at FROM projetos WHERE usuario_id = ? ORDER BY updated_at DESC').all(req.usuario.id);
  return { success: true, projetos: rows.map((r) => ({ id: r.id, nome: r.nome, compartilhar_token: r.compartilhar_token, created_at: r.created_at, updated_at: r.updated_at })) };
});

fastify.post('/api/projetos', { preHandler: authMiddleware }, async (req, reply) => {
  const plano = planoValido(req.usuario);
  const limite = limPlanos[plano] != null ? limPlanos[plano] : limPlanos.free;
  const atual = db.prepare('SELECT COUNT(*) AS c FROM projetos WHERE usuario_id = ?').get(req.usuario.id).c;
  if (atual >= limite) return reply.code(403).send({ error: 'Limite de projetos alcançado no seu plano', limite });
  const id = crypto.randomUUID();
  const nome = (req.body && req.body.nome) ? String(req.body.nome).slice(0, 80) : 'Projeto sem nome';
  const conteudo = (req.body && req.body.conteudo) ? JSON.stringify(req.body.conteudo) : '{}';
  db.prepare('INSERT INTO projetos (id, usuario_id, nome, conteudo, updated_at) VALUES (?, ?, ?, ?, datetime(\'now\'))').run(id, req.usuario.id, nome, conteudo);
  return { success: true, projeto: { id, nome } };
});

fastify.get('/api/projetos/:id', { preHandler: authMiddleware }, async (req, reply) => {
  const { id } = req.params;
  if (!isValidId(id)) return reply.code(400).send({ error: 'ID inválido' });
  const proj = db.prepare('SELECT * FROM projetos WHERE id = ? AND usuario_id = ?').get(id, req.usuario.id);
  if (!proj) return reply.code(404).send({ error: 'Projeto não encontrado' });
  let conteudo = {};
  try { conteudo = JSON.parse(proj.conteudo); } catch (e) { /* noop */ }
  return { success: true, projeto: { id: proj.id, nome: proj.nome, conteudo, created_at: proj.created_at, updated_at: proj.updated_at } };
});

fastify.put('/api/projetos/:id', { preHandler: authMiddleware }, async (req, reply) => {
  const { id } = req.params;
  if (!isValidId(id)) return reply.code(400).send({ error: 'ID inválido' });
  const existe = db.prepare('SELECT id FROM projetos WHERE id = ? AND usuario_id = ?').get(id, req.usuario.id);
  if (!existe) return reply.code(404).send({ error: 'Projeto não encontrado' });
  const body = req.body || {};
  const nome = body.nome != null ? String(body.nome).slice(0, 80) : null;
  const conteudo = body.conteudo != null ? JSON.stringify(body.conteudo) : null;
  if (nome != null) db.prepare('UPDATE projetos SET nome = ? WHERE id = ?').run(nome, id);
  if (conteudo != null) db.prepare('UPDATE projetos SET conteudo = ? WHERE id = ?').run(conteudo, id);
  db.prepare('UPDATE projetos SET updated_at = datetime(\'now\') WHERE id = ?').run(id);
  return { success: true };
});

fastify.delete('/api/projetos/:id', { preHandler: authMiddleware }, async (req, reply) => {
  const { id } = req.params;
  if (!isValidId(id)) return reply.code(400).send({ error: 'ID inválido' });
  const r = db.prepare('DELETE FROM projetos WHERE id = ? AND usuario_id = ?').run(id, req.usuario.id);
  if (!r.changes) return reply.code(404).send({ error: 'Projeto não encontrado' });
  return { success: true };
});

/* --------------------------- compartilhamento --------------------------- */
fastify.post('/api/projetos/:id/share', { preHandler: authMiddleware }, async (req, reply) => {
  const { id } = req.params;
  if (!isValidId(id)) return reply.code(400).send({ error: 'ID inválido' });
  const proj = db.prepare('SELECT * FROM projetos WHERE id = ? AND usuario_id = ?').get(id, req.usuario.id);
  if (!proj) return reply.code(404).send({ error: 'Projeto não encontrado' });
  if (!proj.compartilhar_token) {
    const token = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    db.prepare('UPDATE projetos SET compartilhar_token = ? WHERE id = ?').run(token, id);
    proj.compartilhar_token = token;
  }
  return { success: true, url: '/ver/' + proj.compartilhar_token };
});

fastify.get('/api/s/:token', async (req, reply) => {
  const { token } = req.params;
  if (!isValidId(token)) return reply.code(400).send({ error: 'Token inválido' });
  const proj = db.prepare('SELECT * FROM projetos WHERE compartilhar_token = ?').get(token);
  if (!proj) return reply.code(404).send({ error: 'Compartilhamento não encontrado' });
  let conteudo = {};
  try { conteudo = JSON.parse(proj.conteudo); } catch (e) { /* noop */ }
  return { success: true, projeto: { id: proj.id, nome: proj.nome, conteudo } };
});

/* ----------------------- webhook Mercado Pago --------------------------- */
fastify.post('/webhook/mercadopago', async (req, reply) => {
  const body = req.body || {};
  fastify.log.info({ topic: body.type, action: body.action }, 'Webhook MP recebido');
  const paymentId = (body.data && body.data.id) ? String(body.data.id) : null;
  if (!paymentId) return reply.code(200).send({ received: true });
  db.prepare('INSERT OR IGNORE INTO pagamentos (id, payment_id, status, webhook_body) VALUES (?, ?, ?, ?)')
    .run(crypto.randomUUID(), paymentId, body.type || 'unknown', JSON.stringify(body));
  let plano = 'pro';
  const p = (body.data && body.data.metadata && body.data.metadata.plano) || req.query.plano;
  if (p && limPlanos[p] != null) plano = p;
  const email = (body.data && body.data.metadata && body.data.metadata.email) || req.query.email;
  if (email) {
    const usr = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email.toLowerCase());
    if (usr) {
      const dias = PLANOS[plano] ? PLANOS[plano].dias : 30;
      db.prepare('UPDATE usuarios SET plano = ?, plano_expira = ? WHERE id = ?').run(plano, novoTimestampDias(dias), usr.id);
      db.prepare('UPDATE pagamentos SET usuario_id = ?, plano = ? WHERE payment_id = ?').run(usr.id, plano, paymentId);
      fastify.log.info('Plano ' + plano + ' ativado para ' + email);
    }
  }
  return reply.code(200).send({ received: true });
});

fastify.get('/api/confirmar', async (req, reply) => {
  const { payment_id: paymentId, email, plano } = req.query || {};
  if (!paymentId || !email) return reply.code(400).send({ error: 'payment_id e email são obrigatórios' });
  let aprovado = false;
  if (MP_ACCESS_TOKEN) {
    try {
      const resp = await fetch('https://api.mercadopago.com/v1/payments/' + paymentId, { headers: { Authorization: 'Bearer ' + MP_ACCESS_TOKEN } });
      const pay = await resp.json();
      aprovado = pay.status === 'approved';
    } catch (e) {
      fastify.log.error('Falha ao consultar MP: ' + e.message);
    }
  }
  const usr = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email.toLowerCase());
  if (usr && aprovado) {
    const p = PLANOS[plano] ? plano : 'pro';
    const dias = PLANOS[p] ? PLANOS[p].dias : 30;
    db.prepare('UPDATE usuarios SET plano = ?, plano_expira = ? WHERE id = ?').run(p, novoTimestampDias(dias), usr.id);
    return { success: true, aprovado: true, plano: p };
  }
  return { success: true, aprovado: false };
});

/* --------------------------- estático (front) --------------------------- */
await fastify.register(fastifyStatic, {
  root: PROJECT_ROOT,
  prefix: '/',
  wildcard: false,
  setHeaders: (res, filePath) => {
    if (/\.html$/.test(filePath)) res.setHeader('X-Robots-Tag', 'noindex');
  },
});

fastify.setNotFoundHandler(async (req, reply) => {
  const indexPath = path.join(PROJECT_ROOT, 'index.html');
  if (fs.existsSync(indexPath)) {
    const content = await fs.promises.readFile(indexPath, 'utf-8');
    return reply.type('text/html').send(content);
  }
  return reply.code(404).send('Not Found');
});

const PORT = process.env.PORT || 3002;
await fastify.listen({ port: PORT, host: '0.0.0.0' });
console.log('KitNet 3D API: http://0.0.0.0:' + PORT);
SVREOF
info "src/server.js criado"


# --------------------------------------------------------------
# Dockerfile
# --------------------------------------------------------------
info "Criando Dockerfile"
cat > "$INSTALL_DIR/Dockerfile" <<'DOCKEREOF'
FROM node:22-alpine

WORKDIR /app

# Dependências primeiro (cache de camada)
COPY api/package.json ./
RUN npm install --production

# Código-fonte da API
COPY api/src/ ./src/

# Front estático servido pela mesma API
COPY index.html ./index.html
COPY main.js ./main.js

EXPOSE 3002

CMD ["node", "src/server.js"]
DOCKEREOF


# --------------------------------------------------------------
# docker-compose.yml
# --------------------------------------------------------------
info "Criando docker-compose.yml"
cat > "$INSTALL_DIR/docker-compose.yml" <<'COMPOSEEOF'
services:
  api:
    build: .
    ports:
      - "127.0.0.1:${PORT}:${PORT}"
    environment:
      PORT: ${PORT}
      JWT_SECRET: ${JWT_SECRET}
      DB_PATH: /data/kitnet3d.db
      CORS_ORIGIN: ${CORS_ORIGIN}
      MP_ACCESS_TOKEN: ${MP_ACCESS_TOKEN}
    volumes:
      - ./data:/data
    restart: unless-stopped
COMPOSEEOF


# --------------------------------------------------------------
# Migration SQL (arquivo de referência — tabelas criadas automaticamente no startup)
# --------------------------------------------------------------
info "Criando migration de referência..."
mkdir -p "$INSTALL_DIR/migrations"
cat > "$INSTALL_DIR/migrations/001_create_tables.sql" <<SQLEOF
CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  senha_hash TEXT NOT NULL,
  nome TEXT DEFAULT '',
  plano TEXT DEFAULT 'free',
  plano_expira TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS projetos (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL,
  nome TEXT DEFAULT 'Sem nome',
  conteudo TEXT DEFAULT '{}',
  compartilhar_token TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS pagamentos (
  id TEXT PRIMARY KEY,
  usuario_id TEXT,
  payment_id TEXT UNIQUE,
  plano TEXT,
  valor REAL,
  status TEXT,
  webhook_body TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
SQLEOF


# --------------------------------------------------------------
# Nginx — gera config separada (locations) + include
# --------------------------------------------------------------
info "Configurando Nginx"

NGINX_CONF="/etc/nginx/sites-available/default"
NGINX_ENABLED="/etc/nginx/sites-enabled/default"

# Bloco server dedicado para o domínio da API (se ainda não existir)
if [ -f "$NGINX_CONF" ] && grep -q "server_name.*${APP_DOMAIN}" "$NGINX_CONF"; then
  info "Server block para ${APP_DOMAIN} ja existe — pulando criação"
else
  info "Criando server block para ${APP_DOMAIN} em $NGINX_CONF..."
  cat >> "$NGINX_CONF" <<NGINXEOF

# BEGIN kitnet3d_api
server {
    listen 80;
    listen [::]:80;
    server_name ${APP_DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_set_header Host \$host;
    }
}
# END kitnet3d_api
NGINXEOF
  info "Server block adicionado (porta ${APP_PORT})."
fi

# Garantir que sites-enabled tenha o default habilitado
if [ -f "$NGINX_CONF" ] && [ ! -e "$NGINX_ENABLED" ]; then
  ln -sf "$NGINX_CONF" "$NGINX_ENABLED" && info "Default vinculado em sites-enabled" || warn "Falha ao vincular sites-enabled"
fi


# --------------------------------------------------------------
# Docker Compose — build e start
# --------------------------------------------------------------
info "Fazendo build da imagem Docker..."
if $DOCKER_COMPOSE_CMD -f "$INSTALL_DIR/docker-compose.yml" build 2>&1; then
  info "Build concluído com sucesso!"
else
  error "Falha no build da imagem Docker — verifique o Dockerfile e logs acima"
fi

info "Iniciando containers com Docker Compose..."
if $DOCKER_COMPOSE_CMD -f "$INSTALL_DIR/docker-compose.yml" --project-name "$COMPOSE_PROJECT_NAME" up -d 2>&1; then
  info "Containers iniciados!"
else
  error "Falha ao iniciar containers — verifique docker-compose.yml e logs"
fi

info "Aguardando API ficar saudável..."
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$APP_PORT/health" >/dev/null 2>&1; then
    info "API saudável após ${i}s!"
    break
  fi
  if [ "$i" -eq 30 ]; then
    warn "API não respondeu após 30s — verifique logs: $DOCKER_COMPOSE_CMD logs api"
  fi
  sleep 1
done


# --------------------------------------------------------------
# Nginx reload
# --------------------------------------------------------------
info "Testando e recarregando Nginx"
if nginx -t 2>&1; then
  info "Nginx: configuração válida"
  if systemctl reload nginx.service 2>&1; then
    info "Nginx recarregado com sucesso!"
  else
    warn "Erro ao recarregar nginx — execute manualmente: sudo systemctl reload nginx.service"
  fi
else
  warn "Configuração do nginx inválida — execute manualmente: sudo nginx -t"
fi


# --------------------------------------------------------------
# Final
# --------------------------------------------------------------
echo ""
info "===== Instalação concluída! ====="
echo ""
echo "  Domínio: $APP_DOMAIN  |  Location: /kitnet3d/  |  Porta: $APP_PORT"
echo "  Docker:  $COMPOSE_PROJECT_NAME"
echo "  .env:    $INSTALL_DIR/.env"
echo ""
echo "  Comandos úteis:"
echo "    Logs:     $DOCKER_COMPOSE_CMD -f $INSTALL_DIR/docker-compose.yml logs -f"
echo "    Restart:  $DOCKER_COMPOSE_CMD -f $INSTALL_DIR/docker-compose.yml restart"
echo "    Stop:     $DOCKER_COMPOSE_CMD -f $INSTALL_DIR/docker-compose.yml down"
echo "    Shell:    $DOCKER_COMPOSE_CMD -f $INSTALL_DIR/docker-compose.yml exec api sh"
echo ""

info "Testando API..." && sleep 2
resp=$(curl -s "http://127.0.0.1:$APP_PORT/health" 2>/dev/null) || resp=""
echo "$resp" | grep -q '"status":"ok"\|"ok"' && info "Local:      ✓ http://127.0.0.1:$APP_PORT/health" || warn "Local:      ✗ $resp"
resp2=$(curl -s "http://127.0.0.1:$APP_PORT/ping" 2>/dev/null) || resp2=""
echo "$resp2" | grep -q '"pong":true' && info "Ping:       ✓ http://127.0.0.1:$APP_PORT/ping" || warn "Ping:       ✗ $resp2"

info "Testando via URL externa (aguardar propagação DNS)..."
EXT_URL="https://${APP_DOMAIN}/${COMPOSE_PROJECT_NAME}/health"
resp3=$(curl -s --max-time 10 "$EXT_URL" 2>/dev/null) || resp3=""
echo "$resp3" | grep -q '"status":"ok"\|"ok"' && info "Externo:    ✓ $EXT_URL" || warn "Externo:    ✗ $EXT_URL — $resp3"

echo && info "Testes concluídos!"
echo ""
echo "  .env:    $INSTALL_DIR/.env"
echo ""