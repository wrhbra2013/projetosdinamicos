#!/bin/sh
set -eu

# ==============================================================
# Script de instalação — API Amor Animal (Docker)
# Uso: sudo bash install.sh                          (menu interativo)
#       sudo bash install.sh install                 (instalar)
#       sudo bash install.sh uninstall               (desinstalar)
#       sudo bash install.sh reconfig                (alterar porta)
#       sudo bash install.sh recreate                (recriar container)
#       sudo bash install.sh free-ports              (liberar porta)
#       sudo bash install.sh logs                    (ver logs)
#       sudo bash install.sh stop                    (parar containers)
# ==============================================================

SCRIPT_DIR="$(dirname "$0")"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { printf "${GREEN}[INFO]${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}[WARN]${NC} %s\n" "$1" >&2; }
error() { printf "${RED}[ERRO]${NC} %s\n" "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || error "Execute como root: sudo bash install.sh"

# ==============================================================
# Helpers
# ==============================================================
_check_port() {
  local p=$1
  if command -v ss >/dev/null 2>&1; then
    ss -tlnp "sport = :$p" 2>/dev/null | grep -qv 'State.*Recv-Q' && return 0
  elif command -v lsof >/dev/null 2>&1; then
    lsof -i:"$p" 2>/dev/null | grep -q LISTEN && return 0
  fi
  return 1
}

_diagnostic_api() {
  echo ""
  warn "===== DIAGNÓSTICO DE FALHA ($APP_NAME) ====="
  local api_container="${APP_NAME:-amoranimal}-api"
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "$api_container"; then
    local actual_port
    actual_port=$(docker logs "$api_container" 2>&1 | grep -oP 'port \K\d+' | tail -1)
    if [ -n "$actual_port" ]; then
      warn "API $APP_NAME está ouvindo na porta interna: $actual_port"
      warn "Porta externa configurada: ${PORT:-?}"
      if [ "$actual_port" != "3000" ]; then
        warn "MISMATCH: a API deveria ouvir na porta 3000 (container), mas está em $actual_port"
        warn "Remova a variável PORT do environment no docker-compose.yml"
      fi
    fi
    warn "--- Últimas 20 linhas do log da API ---"
    docker logs "$api_container" --tail 20 2>&1
  else
    warn "Container $api_container ($APP_NAME) não está rodando"
    warn "--- Status dos containers ---"
    docker compose -f "$SCRIPT_DIR/docker-compose.yml" ps 2>&1
    warn "--- Logs completos da API ---"
    docker compose -f "$SCRIPT_DIR/docker-compose.yml" logs --tail=30 api 2>&1
  fi
  echo ""
}

_test_endpoint() {
  local url=$1 label=$2 method=$3 data=$4 expected=$5
  local resp
  resp=$(curl -s --max-time 10 -X "${method:-GET}" "$url" \
    ${data:+-H "Content-Type: application/json" -d "$data"} 2>/dev/null) || resp=""
  if echo "$resp" | grep -q "$expected"; then
    info "$label:    OK"
    return 0
  else
    warn "$label:    FALHA"
    [ -n "$resp" ] && warn "  Resposta: $resp" || warn "  Sem resposta (container pode não estar pronto)"
    return 1
  fi
}

# ==============================================================
# migrate_schema — criar tabelas ausentes do espelho e migrar dados
# ==============================================================
migrate_schema() {
  [ -f "$SCRIPT_DIR/.env" ] && . "$SCRIPT_DIR/.env" || true
  local DB_CONTAINER="${APP_NAME:-amoranimal}-db"
  local DB_NAME="${DB_NAME:-${APP_NAME:-amoranimal}_db}"
  local DB_USER="postgres"

  info "Verificando schema do banco de dados..."

  # Tabelas que a API hardcoded espera (singular, do espelho)
  # 1. login (substitui usuarios)
  docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='login');" 2>/dev/null | grep -q 't' || {
    info "Criando tabela 'login' a partir de 'usuarios'..."
    docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" <<-'SQLEOS'
      CREATE TABLE IF NOT EXISTS login (
          id SERIAL PRIMARY KEY,
          usuario VARCHAR(255) NOT NULL UNIQUE,
          senha VARCHAR(255) NOT NULL,
          isadmin BOOLEAN DEFAULT false,
          origem TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO login (usuario, senha, isadmin)
      SELECT COALESCE(email, nome), senha, (tipo = 'admin')
      FROM usuarios
      WHERE NOT EXISTS (SELECT 1 FROM login LIMIT 1)
      ON CONFLICT (usuario) DO NOTHING;
SQLEOS
    info "Tabela 'login' criada com dados migrados de 'usuarios'."
  }

  # 2. home (substitui settings — estrutura diferente)
  docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='home');" 2>/dev/null | grep -q 't' || {
    info "Criando tabela 'home'..."
    docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" <<-'SQLEOS'
      CREATE TABLE IF NOT EXISTS home (
          id SERIAL PRIMARY KEY,
          origem TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          arquivo VARCHAR(255),
          titulo VARCHAR(255),
          mensagem TEXT,
          link VARCHAR(2083)
      );
SQLEOS
    info "Tabela 'home' criada."
  }

  # 3. Tentar restaurar dump do espelho se existir
  if [ -f /tmp/${APP_NAME}_dump.sql ]; then
    info "Dump encontrado em /tmp/${APP_NAME}_dump.sql. Restaurando..."
    docker cp /tmp/${APP_NAME}_dump.sql "$DB_CONTAINER":/tmp/dump.sql
    docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -f /tmp/dump.sql 2>/dev/null && {
      info "Dump restaurado com sucesso!"
    } || warn "Falha ao restaurar dump (pode ser conflito com tabelas existentes)"
  fi

  # 4. Migrar dados das tabelas singulares (dump) para plurais (API)
  info "Migrando dados das tabelas singulares para plurais..."
  docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" <<-'SQLEOS'
    DO $$
    DECLARE
      m RECORD;
      col RECORD;
      cols TEXT;
      singular_count INTEGER;
    BEGIN
      FOR m IN
        SELECT * FROM (VALUES
          ('adocao',     'animais'),
          ('castracao',  'castracoes'),
          ('parceria',   'parcerias'),
          ('voluntario', 'voluntarios')
        ) AS t(singular, plural)
      LOOP
        -- Se a tabela singular não existe, pular
        IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                       WHERE table_schema='public' AND table_name=m.singular) THEN
          CONTINUE;
        END IF;

        -- Se a tabela plural não existe: renomear singular → plural
        IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                       WHERE table_schema='public' AND table_name=m.plural) THEN
          EXECUTE 'ALTER TABLE "' || m.singular || '" RENAME TO "' || m.plural || '"';
          RAISE NOTICE 'Tabela % renomeada para %', m.singular, m.plural;
          CONTINUE;
        END IF;

        -- Ambas existem: copiar apenas colunas em comum
        EXECUTE 'SELECT count(*) FROM "' || m.singular || '"' INTO singular_count;
        IF singular_count = 0 THEN
          EXECUTE 'DROP TABLE "' || m.singular || '"';
          RAISE NOTICE 'Tabela % vazia, removida', m.singular;
          CONTINUE;
        END IF;

        cols := '';
        FOR col IN
          SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name=m.singular
          INTERSECT
          SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name=m.plural
          ORDER BY column_name
        LOOP
          CONTINUE WHEN col.column_name = 'id';
          IF cols <> '' THEN cols := cols || ', '; END IF;
          cols := cols || '"' || col.column_name || '"';
        END LOOP;

        IF cols <> '' THEN
          BEGIN
            EXECUTE 'INSERT INTO "' || m.plural || '" (' || cols || ') SELECT ' || cols || ' FROM "' || m.singular || '"';
            RAISE NOTICE 'Copiados % registros de % para %', singular_count, m.singular, m.plural;
            EXECUTE 'DROP TABLE "' || m.singular || '"';
            RAISE NOTICE 'Tabela % removida após cópia', m.singular;
          EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Erro ao copiar % para %: %', m.singular, m.plural, SQLERRM;
          END;
        ELSE
          RAISE NOTICE 'Sem colunas em comum entre % e %', m.singular, m.plural;
        END IF;
      END LOOP;
    END $$;
SQLEOS

  # 4b. Mapeamento especial de colunas (nomes diferentes entre singular e plural)
  docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" <<-'SQLEOS'
    DO $$
    DECLARE
      has_nome_pet BOOLEAN;
      has_foto_adocao BOOLEAN;
      has_descricao BOOLEAN;
      cols TEXT;
    BEGIN
      -- Verificar se adotado ainda existe (não foi processado pelo passo 4)
      IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema='public' AND table_name='adotado') THEN
        RETURN;
      END IF;

      -- Verificar colunas disponíveis em adotado
      SELECT EXISTS(SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='adotado' AND column_name='nome_pet') INTO has_nome_pet;
      SELECT EXISTS(SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='adotado' AND column_name='foto_adocao') INTO has_foto_adocao;
      SELECT EXISTS(SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='adotado' AND column_name='descricao') INTO has_descricao;

      cols := 'especie, sexo, idade, porte';
      IF has_nome_pet THEN cols := cols || ', nome_pet as nome'; ELSE cols := cols || ', null::varchar as nome'; END IF;
      IF has_foto_adocao THEN cols := cols || ', foto_adocao as foto_url'; ELSE cols := cols || ', null::varchar as foto_url'; END IF;
      IF has_descricao THEN cols := cols || ', descricao as caracteristicas'; ELSE cols := cols || ', null::varchar as caracteristicas'; END IF;

      EXECUTE 'INSERT INTO animais (nome, especie, sexo, idade, porte, foto_url, caracteristicas, status)'
           || ' SELECT ' || cols || ', ''adotado''::varchar as status FROM adotado';
      RAISE NOTICE 'Dados de adotado migrados para animais com mapeamento especial';
      EXECUTE 'DROP TABLE adotado';
    END $$;
SQLEOS

  # 5. Corrigir caminhos de arquivos vindos do espelho (amoranimalmarilia)
  info "Corrigindo caminhos de arquivos no banco de dados..."
  docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" <<-'SQLEOS'
    -- Corrigir foto_url em animais (vindo de adotado)
    UPDATE animais SET foto_url = regexp_replace(foto_url, '../amoranimal_uploads/', 'uploads/', 'g')
      WHERE foto_url LIKE '../amoranimal_uploads/%';

    -- Corrigir foto_url em procura_se
    UPDATE procura_se SET foto_url = regexp_replace(foto_url, '../amoranimal_uploads/', 'uploads/', 'g')
      WHERE foto_url LIKE '../amoranimal_uploads/%';

    -- Corrigir arquivos de transparencia
    UPDATE transparencia SET arquivo = regexp_replace(arquivo, '../amoranimal_uploads/', 'uploads/', 'g')
      WHERE arquivo LIKE '../amoranimal_uploads/%';

    -- Corrigir foto_url em animais (vindo de adocao)
    UPDATE animais SET foto_url = regexp_replace(foto_url, '../amoranimal_uploads/', 'uploads/', 'g')
      WHERE foto_url LIKE '../amoranimal_uploads/%';
    UPDATE adocoes SET foto_url = regexp_replace(foto_url, '../amoranimal_uploads/', 'uploads/', 'g')
      WHERE foto_url LIKE '../amoranimal_uploads/%';

    -- Corrigir arquivo em home
    UPDATE home SET arquivo = regexp_replace(arquivo, '../amoranimal_uploads/', 'uploads/', 'g')
      WHERE arquivo LIKE '../amoranimal_uploads/%';

    -- Corrigir fotos em eventos
    UPDATE eventos SET fotos = regexp_replace(fotos, '../amoranimal_uploads/', 'uploads/', 'g')
      WHERE fotos LIKE '../amoranimal_uploads/%';

    -- Substituir domínio antigo nos dados
    UPDATE animais SET foto_url = replace(foto_url, 'amoranimal.ong.br', 'projetosdinamicos.com.br')
      WHERE foto_url LIKE '%amoranimal.ong.br%';
    UPDATE procura_se SET foto_url = replace(foto_url, 'amoranimal.ong.br', 'projetosdinamicos.com.br')
      WHERE foto_url LIKE '%amoranimal.ong.br%';
SQLEOS
  info "Caminhos corrigidos."

  info "Migração concluída."
}

# ==============================================================
# Uninstall
# ==============================================================
uninstall() {
  echo ""
  info "===== Iniciando desinstalação da API Amor Animal (Docker) ====="
  echo ""

  [ -f "$SCRIPT_DIR/.env" ] && . "$SCRIPT_DIR/.env" || true

  echo ""
  info "[1/3] Parando containers Docker..."
  docker compose -f "$SCRIPT_DIR/docker-compose.yml" down 2>/dev/null || true
  info "Containers parados."

  echo ""
  info "[2/3] Removendo .env..."
  rm -f "$SCRIPT_DIR/.env" && info ".env removido" || warn ".env não encontrado"

  if [ -n "${DATA_DIR:-}" ] && [ -d "$DATA_DIR" ]; then
    echo ""
    warn "Diretório de dados encontrado: $DATA_DIR"
    printf "  Remover todo o diretório $DATA_DIR? (upload, backup, banco) [s/N]: "; read -r RM_DATA
    case "$RM_DATA" in
      [Ss])
        info "Removendo $DATA_DIR..."
        rm -rf "$DATA_DIR" && info "Diretório removido." || warn "Falha ao remover diretório."
        ;;
    esac
  fi

  echo ""
  info "[3/3] Desinstalação concluída!"
}

# ==============================================================
# Reconfig — alterar porta e recriar container
# ==============================================================
reconfig() {
  echo ""
  info "===== Reconfiguração da API Amor Animal ====="
  echo ""

  [ -f "$SCRIPT_DIR/.env" ] || error ".env não encontrado. Execute a instalação primeiro."

  # Carregar configuração atual
  . "$SCRIPT_DIR/.env"

  echo "Configuração atual:"
  echo "  Porta:      $PORT"
  echo "  App:        ${APP_NAME:-$DB_NAME}"
  echo "  Dados:      ${DATA_DIR:-/var/www/${APP_NAME:-amoranimal}}"
  echo "  Admin:      $ADMIN_EMAIL"
  echo ""

  while :; do
    printf "Nova porta da API [%s]: " "$PORT"
    read -r APP_PORT
    APP_PORT=${APP_PORT:-$PORT}
    if _check_port "$APP_PORT" && [ "$APP_PORT" != "$PORT" ]; then
      warn "Porta $APP_PORT já está em uso!"
      printf "  (M)atar processo, (T)rocar porta, (C)ancelar [M/t/c]: "; read -r PORT_ACT
      case "$PORT_ACT" in
        [Tt]) continue ;;
        [Cc]) error "Reconfiguração cancelada" ;;
        *) fuser -k "$APP_PORT/tcp" 2>/dev/null && info "Processo na porta $APP_PORT encerrado" || warn "Não foi possível encerrar"
           sleep 1 ;;
      esac
    fi
    break
  done

  if [ "$APP_PORT" = "$PORT" ]; then
    info "Porta inalterada ($PORT). Nada a fazer."
    exit 0
  fi

  # Garantir DATA_DIR no .env (compatibilidade com instalações antigas)
  if ! grep -q '^DATA_DIR=' "$SCRIPT_DIR/.env" 2>/dev/null; then
    DATA_DIR="${DATA_DIR:-/var/www/${DB_NAME:-amoranimal}}"
    echo "DATA_DIR=$DATA_DIR" >> "$SCRIPT_DIR/.env"
    info "DATA_DIR adicionado ao .env: $DATA_DIR"
  fi

  # Atualizar .env com a nova porta
  info "Atualizando .env com porta $APP_PORT..."
  sed -i "s/^PORT=.*/PORT=$APP_PORT/" "$SCRIPT_DIR/.env"

  # Corrigir docker-compose.yml existente: remover PORT do environment
  # (versão antiga tinha PORT: \${PORT:-3000} que causava mismatch)
  if grep -q '^\s*PORT:.*\$' "$SCRIPT_DIR/docker-compose.yml" 2>/dev/null; then
    info "Corrigindo docker-compose.yml (removendo PORT do environment)..."
    sed -i '/^\s*PORT:\s*\${/d' "$SCRIPT_DIR/docker-compose.yml"
  fi

  # Corrigir docker-compose.yml: substituir volumes nomeados por bind mounts
  if grep -q '^\s*- pgdata:' "$SCRIPT_DIR/docker-compose.yml" 2>/dev/null; then
    info "Atualizando docker-compose.yml para usar bind mounts..."
    sed -i "s|^\s*- pgdata:|      - \${DATA_DIR}/pgdata:|" "$SCRIPT_DIR/docker-compose.yml"
    sed -i "s|^\s*- api_uploads:|      - \${DATA_DIR}/uploads:|" "$SCRIPT_DIR/docker-compose.yml"
    sed -i "s|^\s*- api_backups:|      - \${DATA_DIR}/backups:|" "$SCRIPT_DIR/docker-compose.yml"
    sed -i '/^volumes:/,/^[a-z]/ { /^volumes:/d; /^  [a-z].*:$/d; }' "$SCRIPT_DIR/docker-compose.yml" 2>/dev/null || true
  fi

  info "Recriando container com a nova porta..."
  docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d --build || {
    error "Falha ao recriar container"
    _diagnostic_api
    exit 1
  }

  echo ""
  info "===== Reconfiguração concluída! ====="
  echo ""
  echo "  API:       http://localhost:$APP_PORT"
  echo ""
}

# ==============================================================
# Recreate — recriar container
# ==============================================================
recreate() {
  echo ""
  info "===== Recriando container da API ====="
  echo ""
  [ -f "$SCRIPT_DIR/.env" ] || error ".env não encontrado."
  . "$SCRIPT_DIR/.env"

  docker compose -f "$SCRIPT_DIR/docker-compose.yml" down 2>/dev/null || true
  info "Container parado. Recriando..."
  docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d --build || {
    error "Falha ao recriar container"
    _diagnostic_api
    exit 1
  }
  info "Container recriado com sucesso!"
  echo "  API: http://localhost:$PORT"
}

# ==============================================================
# Free ports — liberar porta configurada no .env
# ==============================================================
free_ports() {
  echo ""
  info "===== Liberando portas ====="
  echo ""
  [ -f "$SCRIPT_DIR/.env" ] || error ".env não encontrado."
  . "$SCRIPT_DIR/.env"

  local port_atual=$PORT
  if _check_port "$port_atual"; then
    warn "Porta $port_atual está em uso!"
    printf "  Encerrar processo na porta $port_atual? [S/n]: "; read -r CONFIRM
    case "$CONFIRM" in
      [Nn]) info "Operação cancelada." ;;
      *)
        fuser -k "$port_atual/tcp" 2>/dev/null && \
          info "Processo na porta $port_atual encerrado" || \
          warn "Não foi possível encerrar processo na porta $port_atual"
        ;;
    esac
  else
    info "Porta $port_atual já está livre."
  fi

  # Verificar containers parados com a mesma porta
  if docker ps -a --format '{{.Ports}}' 2>/dev/null | grep -q "$port_atual"; then
    warn "A porta $port_atual também está mapeada em um container Docker."
    printf "  Parar e remover container? [s/N]: "; read -r STOP_DOCKER
    case "$STOP_DOCKER" in
      [Ss])
        docker compose -f "$SCRIPT_DIR/docker-compose.yml" down 2>/dev/null || true
        info "Container Docker parado."
        ;;
    esac
  fi
  echo ""
}

# ==============================================================
# Logs API — mostrar logs da API
# ==============================================================
logs_api() {
  local api_container="${APP_NAME:-amoranimal}-api"
  echo ""
  info "===== Logs da API (últimas 30 linhas) ====="
  echo ""
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "$api_container"; then
    docker logs "$api_container" --tail 30 2>&1
    echo ""
    info "Para acompanhar em tempo real: docker logs -f $api_container"
  else
    warn "Container $api_container não está rodando."
    docker compose -f "$SCRIPT_DIR/docker-compose.yml" logs --tail=30 api 2>&1 || \
      warn "Nenhum log disponível."
  fi
}

# ==============================================================
# Stop — parar containers
# ==============================================================
stop_containers() {
  echo ""
  info "===== Parando containers ====="
  echo ""
  if [ -f "$SCRIPT_DIR/docker-compose.yml" ]; then
    docker compose -f "$SCRIPT_DIR/docker-compose.yml" down 2>/dev/null || true
    info "Containers parados."
  else
    warn "docker-compose.yml não encontrado."
  fi
}

# ==============================================================
# Install
# ==============================================================
install_docker_debian() {
  command -v apt-get >/dev/null 2>&1 || error "apt-get não encontrado"

  dpkg --configure -a 2>/dev/null || true
  apt-get install -f -y -qq 2>/dev/null || true

  if dpkg -l 2>/dev/null | grep -qE '^iF|^iU'; then
    info "Removendo pacotes com configuração pendente..."
    for pkg in $(dpkg -l | awk '/^iF|^iU/{print $2}'); do
      dpkg --purge --force-depends "$pkg" 2>/dev/null || true
    done
    apt-get install -f -y -qq 2>/dev/null || true
  fi

  info "Adicionando repositório Docker..."
  apt-get install -y -qq ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list

  apt-get update -qq
  if apt-get install -y -qq docker-ce docker-compose-plugin; then
    systemctl enable docker.service && systemctl start docker.service
    info "Docker instalado com sucesso"
  else
    warn "Falha ao instalar Docker"
    warn "  sudo apt-get install docker-ce docker-compose-plugin"
    error "Instalação do Docker falhou"
  fi
}

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  if [ -f /etc/debian_version ]; then
    printf "Docker não encontrado. Instalar Docker para Debian? [S/n]: "; read -r INSTALL_DOCKER
    case "$INSTALL_DOCKER" in
      [Nn]) error "Docker é necessário para instalação" ;;
      *) install_docker_debian ;;
    esac
  else
    error "Docker não encontrado. Instale Docker e docker compose plugin manualmente"
  fi
fi

# ==============================================================
# install_flow — instalação completa
# ==============================================================
install_flow() {
  echo ""
  info "===== Instalação da API Amor Animal (Docker) ====="
  echo ""
  echo "============ Configuração ============"

  while :; do
    printf "Porta da API [3000]: "; read -r APP_PORT
    APP_PORT=${APP_PORT:-3000}
    if _check_port "$APP_PORT"; then
      warn "Porta $APP_PORT já está em uso!"
      printf "  (M)atar processo, (T)rocar porta, (C)ancelar [M/t/c]: "; read -r PORT_ACT
      case "$PORT_ACT" in
        [Tt]) continue ;;
        [Cc]) error "Instalação cancelada" ;;
        *) fuser -k "$APP_PORT/tcp" 2>/dev/null && info "Processo na porta $APP_PORT encerrado" || warn "Não foi possível encerrar"
           sleep 1 ;;
      esac
    fi
    break
  done

  printf "Nome do app (ex: amoranimal): "; read -r APP_NAME
  APP_NAME=${APP_NAME:-amoranimal}
  # Sanitizar: lower case, underscores, sem espaços
  APP_NAME=$(printf '%s' "$APP_NAME" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9_' '_')

  # Derivar configurações do nome do app
  DB_NAME="${APP_NAME}_db"
  DB_PASS=postgres
  DATA_DIR="/var/www/${APP_NAME}"

  printf "Email do administrador [amoranimalmariliadev@gmail.com]: "; read -r ADMIN_EMAIL
  ADMIN_EMAIL=${ADMIN_EMAIL:-amoranimalmariliadev@gmail.com}
  printf "Nome do administrador [admin]: "; read -r ADMIN_NOME
  ADMIN_NOME=${ADMIN_NOME:-admin}
  printf "Senha do administrador [@admin]: "; stty -echo; read -r ADMIN_PASS; stty echo; echo ""
  ADMIN_PASS=${ADMIN_PASS:-@admin}

  # ==============================================================
  # Criar estrutura de diretórios
  # ==============================================================
  info "Criando estrutura de diretórios..."
  mkdir -p "$SCRIPT_DIR/api/src" "$SCRIPT_DIR/db/init" "$DATA_DIR"/{pgdata,uploads,backups}

  # ==============================================================
  # Gerar arquivos necessários via heredoc
  # ==============================================================

  info "Gerando docker-compose.yml..."
  cat > "$SCRIPT_DIR/docker-compose.yml" <<'COMPOSEEOF'
services:
  db:
    image: postgres:16-alpine
    container_name: amoranimal-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${DB_USER:-postgres}
      POSTGRES_PASSWORD: ${DB_PASS:-postgres}
      POSTGRES_DB: ${DB_NAME:-amoranimal_db}
      ADMIN_EMAIL: ${ADMIN_EMAIL:-admin@amoranimal.ong.br}
      ADMIN_NOME: ${ADMIN_NOME:-admin}
      ADMIN_PASS: ${ADMIN_PASS:-@admin}
    volumes:
      - ${DATA_DIR}/pgdata:/var/lib/postgresql/data
      - ./db/init/01-schema.sql:/docker-entrypoint-initdb.d/01-schema.sql:ro
      - ./db/init/02-seed.sh:/docker-entrypoint-initdb.d/02-seed.sh:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${DB_USER:-postgres} -d $${DB_NAME:-amoranimal_db}"]
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    build:
      context: ./api
      dockerfile: Dockerfile
    container_name: amoranimal-api
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      APP_NAME: ${APP_NAME:-amoranimal}
      DB_HOST: db
      DB_PORT: 5432
      DB_NAME: ${DB_NAME:-amoranimal_db}
      DB_USER: ${DB_USER:-postgres}
      DB_PASS: ${DB_PASS:-postgres}
    volumes:
      - ${DATA_DIR}/uploads:/app/uploads
      - ${DATA_DIR}/backups:/app/backups
    ports:
      - "${PORT:-3000}:3000"
COMPOSEEOF

  # Corrigir nomes hardcoded no docker-compose.yml
  sed -i "s/container_name: amoranimal-db/container_name: ${APP_NAME}-db/g" "$SCRIPT_DIR/docker-compose.yml"
  sed -i "s/container_name: amoranimal-api/container_name: ${APP_NAME}-api/g" "$SCRIPT_DIR/docker-compose.yml"
  sed -i "s/amoranimal_db/${APP_NAME}_db/g" "$SCRIPT_DIR/docker-compose.yml"
  sed -i "s|ADMIN_EMAIL: \${ADMIN_EMAIL:-admin@amoranimal.ong.br}|ADMIN_EMAIL: \${ADMIN_EMAIL:-${ADMIN_EMAIL}}|g" "$SCRIPT_DIR/docker-compose.yml"

  info "Gerando api/Dockerfile..."
  cat > "$SCRIPT_DIR/api/Dockerfile" <<'DOCKEREOF'
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
DOCKEREOF

  info "Gerando api/package.json..."
  cat > "$SCRIPT_DIR/api/package.json" <<'PKGEOF'
{
  "name": "amoranimal-api",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.21.0",
    "pg": "^8.12.0"
  }
}
PKGEOF

  sed -i "s|\"name\": \"amoranimal-api\"|\"name\": \"${APP_NAME}-api\"|" "$SCRIPT_DIR/api/package.json"

  info "Gerando api/src/server.js..."
  cat > "$SCRIPT_DIR/api/src/server.js" <<'SVREOF'
const { Pool } = require('pg');
const express = require('express');

const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const PROJETO = process.env.APP_NAME || 'amoranimal';

const pool = new Pool({
    host: process.env.DB_HOST || 'db',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'amoranimal_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || 'postgres'
});

pool.on('error', (err) => console.error('DB Error:', err));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOrigins = [
        'https://www.projetosdinamicos.com.br',
        'https://api.projetosdinamicos.com.br'
    ];
    if (origin) {
        const match = allowedOrigins.find(o => origin === o || origin.endsWith('://' + o.split('://')[1]));
        if (match) {
            res.header('Access-Control-Allow-Origin', match);
            res.header('Vary', 'Origin');
        }
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

function gerarTicket(tipo, seq) {
    const prefixo = tipo === 'mutirao' ? 'M' : tipo === 'pets_rua' ? 'R' : 'B';
    return prefixo + String(seq).padStart(3, '0');
}

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

app.get('/', (req, res) => {
    res.json({
        message: 'API Running',
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
        const token = crypto.createHash('sha256')
            .update(user.usuario + Date.now() + 'amoranimal_secret')
            .digest('hex');
        res.json({ success: true, token, usuario: user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/settings', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM home ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/settings', async (req, res) => {
    const { titulo, mensagem, link, arquivo } = req.body;
    if (!titulo) {
        return res.status(400).json({ error: 'titulo é obrigatório' });
    }
    try {
        const result = await pool.query(
            `INSERT INTO home (titulo, mensagem, link, arquivo) VALUES ($1, $2, $3, $4) RETURNING *`,
            [titulo, mensagem || null, link || null, arquivo || null]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/search', async (req, res) => {
    const { q } = req.query;
    if (!q || q.length < 2) {
        return res.json({ results: [] });
    }
    try {
        const term = '%' + q.toLowerCase() + '%';
        const results = [];

        if (await tabelaExiste('eventos')) {
            const r = await pool.query(
                `SELECT id, titulo, LEFT(COALESCE(descricao,''),100) as descricao, 'eventos' as tabela FROM eventos WHERE LOWER(titulo) LIKE $1 OR LOWER(COALESCE(descricao,'')) LIKE $1 OR LOWER(COALESCE(local,'')) LIKE $1 LIMIT 5`,
                [term]
            );
            results.push(...r.rows);
        }

        if (await tabelaExiste('castracoes')) {
            const r = await pool.query(
                `SELECT id, pet_nome as titulo, tutor_nome || ' - ' || COALESCE(clinica,'') as descricao, 'castracoes' as tabela FROM castracoes WHERE LOWER(pet_nome) LIKE $1 OR LOWER(tutor_nome) LIKE $1 OR LOWER(COALESCE(clinica,'')) LIKE $1 LIMIT 5`,
                [term]
            );
            results.push(...r.rows);
        }

        if (await tabelaExiste('animais')) {
            const r = await pool.query(
                `SELECT id, nome as titulo, COALESCE(especie,'') || ' - ' || LEFT(COALESCE(caracteristicas,''),100) as descricao, 'animais' as tabela FROM animais WHERE LOWER(nome) LIKE $1 OR LOWER(COALESCE(especie,'')) LIKE $1 OR LOWER(COALESCE(caracteristicas,'')) LIKE $1 LIMIT 5`,
                [term]
            );
            results.push(...r.rows);
        }

        if (await tabelaExiste('voluntarios')) {
            const r = await pool.query(
                `SELECT id, nome as titulo, COALESCE(localidade,'') || ' - ' || LEFT(COALESCE(habilidade,''),100) as descricao, 'voluntarios' as tabela FROM voluntarios WHERE LOWER(nome) LIKE $1 OR LOWER(COALESCE(localidade,'')) LIKE $1 OR LOWER(COALESCE(habilidade,'')) LIKE $1 LIMIT 5`,
                [term]
            );
            results.push(...r.rows);
        }

        if (await tabelaExiste('parcerias')) {
            const r = await pool.query(
                `SELECT id, empresa as titulo, COALESCE(localidade,'') || ' - ' || COALESCE(representante,'') as descricao, 'parcerias' as tabela FROM parcerias WHERE LOWER(empresa) LIKE $1 OR LOWER(COALESCE(localidade,'')) LIKE $1 OR LOWER(COALESCE(representante,'')) LIKE $1 LIMIT 5`,
                [term]
            );
            results.push(...r.rows);
        }

        if (await tabelaExiste('procura_se')) {
            const r = await pool.query(
                `SELECT id, COALESCE(nome,'') as titulo, COALESCE(especie,'') || ' - ' || LEFT(COALESCE(informacoes,''),100) as descricao, 'procura_se' as tabela FROM procura_se WHERE LOWER(COALESCE(nome,'')) LIKE $1 OR LOWER(COALESCE(especie,'')) LIKE $1 OR LOWER(COALESCE(informacoes,'')) LIKE $1 LIMIT 5`,
                [term]
            );
            results.push(...r.rows);
        }

        res.json({ results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Eventos photo upload handlers ---
app.post('/eventos', async (req, res) => {
    const data = req.body;
    try {
        await garantirTabela('eventos', data);
        await garantirColunas('eventos', data);

        if (data.fotos && typeof data.fotos === 'string' && data.fotos.startsWith('data:')) {
            const fs = require('fs');
            const uploadDir = path.join(__dirname, '..', 'uploads', 'eventos');
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

            const matches = data.fotos.match(/^data:([^;]+);base64,(.+)$/);
            if (matches) {
                const mimeMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };
                const ext = mimeMap[matches[1]] || '.jpg';
                const timestamp = Date.now();
                const nomeArquivo = 'foto_' + timestamp + ext;
                const buffer = Buffer.from(matches[2], 'base64');
                fs.writeFileSync(path.join(uploadDir, nomeArquivo), buffer);
                data.fotos = nomeArquivo;
            }
        }

        const keys = Object.keys(data).map(k => `"${k}"`).join(', ');
        const values = Object.keys(data).map((_, i) => `$${i + 1}`).join(', ');
        const result = await pool.query(
            `INSERT INTO "eventos" (${keys}) VALUES (${values}) RETURNING *;`,
            Object.values(data)
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/eventos/:id', async (req, res) => {
    const { id } = req.params;
    const data = req.body;
    try {
        await garantirColunas('eventos', data);

        if (data.fotos && typeof data.fotos === 'string' && data.fotos.startsWith('data:')) {
            const fs = require('fs');
            const uploadDir = path.join(__dirname, '..', 'uploads', 'eventos');
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

            const matches = data.fotos.match(/^data:([^;]+);base64,(.+)$/);
            if (matches) {
                const mimeMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };
                const ext = mimeMap[matches[1]] || '.jpg';
                const timestamp = Date.now();
                const nomeArquivo = 'foto_' + timestamp + ext;
                const buffer = Buffer.from(matches[2], 'base64');
                fs.writeFileSync(path.join(uploadDir, nomeArquivo), buffer);
                data.fotos = nomeArquivo;
            }
        }

        const keys = Object.keys(data).map((k, i) => `"${k}" = $${i + 1}`).join(', ');
        const result = await pool.query(
            `UPDATE "eventos" SET ${keys} WHERE id = $${Object.keys(data).length + 1} RETURNING *;`,
            [...Object.values(data), id]
        );
        res.json(result.rows[0] || { error: 'Evento não encontrado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// --- End eventos photo upload handlers ---

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

        if (tabela === 'castracoes' && !data.ticket) {
            const seqResult = await pool.query("SELECT nextval('castracoes_id_seq')");
            const seq = seqResult.rows[0].nextval;
            data.ticket = gerarTicket(data.tipo || 'baixo_custo', seq);
        }

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

app.get('/transparencia', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM transparencia ORDER BY ano DESC, origem DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/transparencia', async (req, res) => {
    const { titulo, tipo, ano, descricao, arquivo, arquivo_nome, arquivo_data } = req.body;
    if (!titulo || !tipo || !ano) {
        return res.status(400).json({ error: 'titulo, tipo e ano são obrigatórios' });
    }
    try {
        const fs = require('fs');
        let nomeArquivo = arquivo || null;

        if (arquivo_data && arquivo_nome) {
            const uploadDir = path.join(__dirname, '..', 'uploads', 'transparencia');
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

            const ext = path.extname(arquivo_nome) || '.bin';
            const base = path.basename(arquivo_nome, ext)
                .toLowerCase()
                .replace(/[\s]+/g, '_')
                .replace(/[^a-z0-9_-]/g, '');
            const timestamp = Date.now();
            nomeArquivo = base + '_' + timestamp + ext;

            const matches = arquivo_data.match(/^data:([^;]+);base64,(.+)$/);
            if (matches) {
                const buffer = Buffer.from(matches[2], 'base64');
                fs.writeFileSync(path.join(uploadDir, nomeArquivo), buffer);
            } else {
                const buffer = Buffer.from(arquivo_data, 'base64');
                fs.writeFileSync(path.join(uploadDir, nomeArquivo), buffer);
            }
        }

        const result = await pool.query(
            `INSERT INTO transparencia (titulo, tipo, ano, descricao, arquivo)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [titulo, tipo, ano, descricao || null, nomeArquivo]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/transparencia/:id/:arquivo', async (req, res) => {
    const { id, arquivo } = req.params;
    try {
        const fs = require('fs');
        const filepath = path.join(__dirname, '..', 'uploads', 'transparencia', arquivo);
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);

        await pool.query('DELETE FROM transparencia WHERE id = $1', [id]);
        res.json({ success: true, message: 'Documento excluído' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/relatorio/tabelas', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name
        `);
        res.json({ tables: result.rows.map(r => r.table_name) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/relatorio/backup', async (req, res) => {
    try {
        const fs = require('fs');
        const backupDir = path.join(__dirname, '..', 'backups');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        const filename = `backup_${new Date().toISOString().slice(0, 10)}_${Date.now()}.sql`;
        const filepath = path.join(backupDir, filename);

        const result = await pool.query(`
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        `);
        let sql = '-- Backup Amor Animal - ' + new Date().toISOString() + '\n\n';
        for (const row of result.rows) {
            const tableName = row.table_name;
            const data = await pool.query(`SELECT * FROM "${tableName}"`);
            if (data.rows.length === 0) continue;
            const cols = Object.keys(data.rows[0]).map(c => `"${c}"`).join(', ');
            for (const r of data.rows) {
                const vals = Object.values(r).map(v => {
                    if (v === null || v === undefined) return 'NULL';
                    if (typeof v === 'number') return v;
                    return `'${String(v).replace(/'/g, "''")}'`;
                }).join(', ');
                sql += `INSERT INTO "${tableName}" (${cols}) VALUES (${vals});\n`;
            }
        }
        fs.writeFileSync(filepath, sql);
        res.json({ success: true, message: 'Backup criado', file: filename, log: `Backup salvo: ${filename}` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, log: 'Erro: ' + err.message });
    }
});

app.get('/relatorio/backups', async (req, res) => {
    try {
        const fs = require('fs');
        const backupDir = path.join(__dirname, '..', 'backups');
        if (!fs.existsSync(backupDir)) {
            return res.json({ success: true, files: [] });
        }
        const files = fs.readdirSync(backupDir)
            .filter(f => f.endsWith('.sql'))
            .sort()
            .reverse();
        res.json({ success: true, files });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/relatorio/restore', async (req, res) => {
    const { tabela, backupFile } = req.query;
    if (!tabela || !backupFile) {
        return res.status(400).json({ success: false, error: 'tabela e backupFile são obrigatórios', log: 'Parâmetros faltando' });
    }
    try {
        const fs = require('fs');
        const filepath = path.join(__dirname, '..', 'backups', backupFile);
        if (!fs.existsSync(filepath)) {
            return res.status(404).json({ success: false, error: 'Backup não encontrado', log: 'Arquivo não encontrado' });
        }

        await pool.query(`DELETE FROM "${tabela}"`);
        const content = fs.readFileSync(filepath, 'utf8');
        const lines = content.split('\n').filter(l => l.startsWith('INSERT') && l.includes(`"${tabela}"`));
        for (const line of lines) {
            await pool.query(line);
        }
        res.json({ success: true, message: `Tabela "${tabela}" restaurada`, log: `Restaurado de: ${backupFile}` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, log: 'Erro: ' + err.message });
    }
});

app.post('/relatorio/maintenance', async (req, res) => {
    const { option } = req.query;
    const { execSync } = require('child_process');
    const logs = [];
    try {
        switch (option) {
            case '1':
                logs.push('Docker: git pull not supported inside container');
                break;
            case '3':
                logs.push('Docker: git pull not supported inside container');
                break;
            case '4':
                execSync('npm install --prefix ' + path.join(__dirname, '..') + ' 2>&1', { timeout: 60000 });
                logs.push('Dependências instaladas');
                break;
            case '5':
                logs.push('Docker: reinicie o container: docker compose restart api');
                break;
            default:
                logs.push('Opção não implementada: ' + option);
        }
        res.json({ success: true, log: logs.join('\n') });
    } catch (err) {
        res.status(500).json({ success: false, log: logs.join('\n') + '\nErro: ' + err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
SVREOF

  # Corrigir defaults e strings hardcoded no server.js
  sed -i "s#process.env.APP_NAME || 'amoranimal'#process.env.APP_NAME || '${APP_NAME}'#" "$SCRIPT_DIR/api/src/server.js"
  sed -i "s#process.env.DB_NAME || 'amoranimal_db'#process.env.DB_NAME || '${APP_NAME}_db'#" "$SCRIPT_DIR/api/src/server.js"
  sed -i "s/'amoranimal_secret'/'${APP_NAME}_secret'/g" "$SCRIPT_DIR/api/src/server.js"
  sed -i "s|-- Backup Amor Animal|-- Backup ${APP_NAME}|" "$SCRIPT_DIR/api/src/server.js"

  info "Gerando db/init/01-schema.sql..."
  cat > "$SCRIPT_DIR/db/init/01-schema.sql" <<'SQLEOF'
CREATE TABLE IF NOT EXISTS settings (
    chave VARCHAR(100) PRIMARY KEY,
    valor TEXT
);

CREATE TABLE IF NOT EXISTS animais (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    especie VARCHAR(50),
    porte VARCHAR(50),
    idade VARCHAR(100),
    sexo VARCHAR(20),
    caracteristicas TEXT,
    foto_url TEXT,
    status VARCHAR(50) DEFAULT 'disponivel',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS adocoes (
    id SERIAL PRIMARY KEY,
    adotante_nome VARCHAR(255) NOT NULL,
    adotante_cpf VARCHAR(20),
    adotante_contato VARCHAR(100),
    adotante_endereco TEXT,
    adotante_numero VARCHAR(20),
    adotante_bairro VARCHAR(100),
    adotante_cidade VARCHAR(100),
    adotante_estado VARCHAR(10),
    adotante_cep VARCHAR(15),
    pet_nome VARCHAR(255) NOT NULL,
    pet_especie VARCHAR(50),
    pet_sexo VARCHAR(20),
    pet_idade VARCHAR(100),
    pet_porte VARCHAR(50),
    pet_castrado VARCHAR(20),
    pet_vermifugado VARCHAR(20),
    pet_vacinado VARCHAR(20),
    pet_endereco VARCHAR(50),
    protocolo VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS castracoes (
    id SERIAL PRIMARY KEY,
    tipo VARCHAR(50) NOT NULL,
    ticket VARCHAR(20),
    tutor_nome VARCHAR(255) NOT NULL,
    tutor_telefone VARCHAR(50),
    tutor_email VARCHAR(255),
    tutor_cpf VARCHAR(20),
    tutor_endereco TEXT,
    tutor_numero VARCHAR(20),
    tutor_complemento VARCHAR(100),
    tutor_bairro VARCHAR(100),
    tutor_cidade VARCHAR(100),
    tutor_estado VARCHAR(10),
    tutor_cep VARCHAR(15),
    tutor_localidade VARCHAR(100),
    tutor_whatsapp VARCHAR(10),
    pet_nome VARCHAR(255) NOT NULL,
    pet_especie VARCHAR(50),
    pet_sexo VARCHAR(20),
    pet_idade VARCHAR(50),
    pet_porte VARCHAR(50),
    pet_peso VARCHAR(50),
    pet_vacinado BOOLEAN DEFAULT FALSE,
    pet_medicamento TEXT,
    clinica VARCHAR(255),
    agenda VARCHAR(50),
    data_agendamento DATE,
    dia_semana VARCHAR(30),
    status VARCHAR(50) DEFAULT 'Pendente',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS doacoes (
    id SERIAL PRIMARY KEY,
    doador_nome VARCHAR(255),
    doador_contato VARCHAR(100),
    tipo VARCHAR(50),
    valor DECIMAL(10,2),
    descricao TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS eventos (
    id SERIAL PRIMARY KEY,
    titulo VARCHAR(255) NOT NULL,
    descricao TEXT,
    data_evento DATE,
    local VARCHAR(255),
    endereco TEXT,
    fotos TEXT,
    status VARCHAR(50) DEFAULT 'agendado',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS parcerias (
    id SERIAL PRIMARY KEY,
    empresa VARCHAR(255) NOT NULL,
    localidade VARCHAR(255),
    proposta TEXT,
    representante VARCHAR(255) NOT NULL,
    telefone VARCHAR(50),
    whatsapp VARCHAR(10),
    email VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS procura_se (
    id SERIAL PRIMARY KEY,
    origem TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    nome VARCHAR(255),
    especie VARCHAR(100),
    sexo VARCHAR(50),
    idade VARCHAR(50),
    porte VARCHAR(50),
    cor VARCHAR(100),
    foto_url TEXT,
    informacoes TEXT,
    contato VARCHAR(255),
    status VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS voluntarios (
    id SERIAL PRIMARY KEY,
    origem TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    nome VARCHAR(255),
    localidade VARCHAR(255),
    telefone VARCHAR(20),
    whatsapp VARCHAR(20),
    disponibilidade TEXT,
    habilidade TEXT,
    mensagem TEXT
);

CREATE TABLE IF NOT EXISTS coleta (
    id SERIAL PRIMARY KEY,
    origem TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    nome VARCHAR(255),
    telefone VARCHAR(20),
    whatsapp VARCHAR(20),
    item VARCHAR(255),
    quantidade VARCHAR(50),
    dia VARCHAR(10),
    hora TIME,
    cep VARCHAR(10),
    endereco VARCHAR(255),
    numero VARCHAR(20),
    complemento VARCHAR(100),
    bairro VARCHAR(100),
    cidade VARCHAR(100),
    estado VARCHAR(50),
    mensagem TEXT
);

CREATE TABLE IF NOT EXISTS login (
    id SERIAL PRIMARY KEY,
    usuario VARCHAR(255) NOT NULL UNIQUE,
    senha VARCHAR(255) NOT NULL,
    isadmin BOOLEAN DEFAULT false,
    origem TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    senha VARCHAR(255) NOT NULL,
    tipo VARCHAR(50) DEFAULT 'voluntario',
    localidade VARCHAR(100),
    habilidades TEXT,
    disponibilidade VARCHAR(100),
    foto_url TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transparencia (
    id SERIAL PRIMARY KEY,
    titulo VARCHAR(255) NOT NULL,
    tipo VARCHAR(50) NOT NULL,
    ano INTEGER,
    descricao TEXT,
    arquivo TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
SQLEOF

  info "Gerando db/init/02-seed.sh..."
  cat > "$SCRIPT_DIR/db/init/02-seed.sh" <<SEEDEOF
#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "\$POSTGRES_USER" --dbname "\$POSTGRES_DB" <<-EOSQL
    INSERT INTO settings (chave, valor) VALUES ('clinica_baixo', 'E O BICHO') ON CONFLICT (chave) DO NOTHING;
    INSERT INTO settings (chave, valor) VALUES ('clinica_pets', 'E O BICHO') ON CONFLICT (chave) DO NOTHING;

    INSERT INTO login (usuario, senha, isadmin)
    VALUES ('${ADMIN_EMAIL}', '${ADMIN_PASS}', true)
    ON CONFLICT (usuario) DO NOTHING;
EOSQL
SEEDEOF
  chmod +x "$SCRIPT_DIR/db/init/02-seed.sh"

  # ==============================================================
  info "Criando .env"
  cat > "$SCRIPT_DIR/.env" <<EOF
PORT=$APP_PORT
APP_NAME=$APP_NAME
DATA_DIR=$DATA_DIR
DB_HOST=db
DB_PORT=5432
DB_NAME=$DB_NAME
DB_USER=postgres
DB_PASS=$DB_PASS
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_NOME=$ADMIN_NOME
ADMIN_PASS=$ADMIN_PASS
EOF

  # ==============================================================
  # Migrar dados do banco espelho (amoranimalmarilia)
  # ==============================================================
  echo ""
  printf "Deseja clonar dados do banco 'espelho' e copiar uploads do amoranimalmarilia? [s/N]: "
  read -r CLONE_ESPELHO
  case "$CLONE_ESPELHO" in
    [Ss])
      # Descobrir caminho do projeto amoranimalmarilia
      ESPELHO_DIR=""
      for try_dir in "/home/debian/amoranimalmarilia" "/home/wander/Public/amoranimalmarilia" "/var/www/amoranimalmarilia" "/opt/amoranimalmarilia"; do
        [ -d "$try_dir" ] && ESPELHO_DIR="$try_dir" && break
      done

      # Dump do banco espelho local
      if command -v pg_dump >/dev/null 2>&1; then
        info "Exportando banco 'espelho' local..."
        if sudo -u postgres pg_dump -d espelho > "/tmp/${APP_NAME}_dump.sql" 2>/dev/null; then
          info "Banco 'espelho' exportado para /tmp/${APP_NAME}_dump.sql"
        elif PGPASSWORD="$DB_PASS" pg_dump -h 127.0.0.1 -U postgres -d espelho > "/tmp/${APP_NAME}_dump.sql" 2>/dev/null; then
          info "Banco 'espelho' exportado (TCP) para /tmp/${APP_NAME}_dump.sql"
        else
          warn "Não foi possível exportar banco 'espelho'. Pule esta etapa ou execute manualmente depois."
        fi
      else
        warn "pg_dump não encontrado. Instale o postgresql-client ou exporte manualmente."
      fi

      # Copiar uploads do amoranimalmarilia
      UPLOADS_SRC=""
      if [ -n "$ESPELHO_DIR" ] && [ -d "${ESPELHO_DIR%/*}/amoranimal_uploads" ]; then
        UPLOADS_SRC="${ESPELHO_DIR%/*}/amoranimal_uploads"
      elif [ -d "/home/debian/amoranimal_uploads" ]; then
        UPLOADS_SRC="/home/debian/amoranimal_uploads"
      fi
      if [ -n "$UPLOADS_SRC" ]; then
        info "Copiando uploads de $UPLOADS_SRC para $DATA_DIR/uploads..."
        mkdir -p "$DATA_DIR/uploads"
        cp -rn "$UPLOADS_SRC/"* "$DATA_DIR/uploads/" 2>/dev/null && \
          info "Uploads copiados com sucesso!" || \
          warn "Falha ao copiar alguns arquivos (podem já existir)."
      else
        warn "Diretório de uploads do amoranimalmarilia não encontrado."
      fi
      ;;
  esac

  # ==============================================================
  # Construir e iniciar containers
  # ==============================================================
  info "Parando containers existentes (se houver)..."
  docker compose -f "$SCRIPT_DIR/docker-compose.yml" down 2>/dev/null || true

  info "Construindo e iniciando containers..."
  if ! docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d --build; then
    echo ""
    error "Falha ao construir/iniciar containers"
    _diagnostic_api
    echo ""
    info "Tente corrigir e executar manualmente:"
    echo "  sudo docker compose -f $SCRIPT_DIR/docker-compose.yml up -d --build"
    exit 1
  fi

  echo ""
  info "===== Instalação concluída! ====="
  echo ""
  echo "  Projeto:   $APP_NAME"
  echo "  API:       http://localhost:$APP_PORT"
  echo "  Health:    http://localhost:$APP_PORT/health"
  echo "  Admin:     $ADMIN_EMAIL / $ADMIN_PASS"
  echo ""

  # ==============================================================
  # Migrar schema do banco (criar tabelas login, home e restaurar dump)
  # ==============================================================
  info "Aguardando banco de dados ficar pronto..."
  sleep 5
  migrate_schema 2>/dev/null || warn "Migração automática falhou (pode executar manualmente depois)"

  # ==============================================================
  # Testes com curl e diagnóstico automático
  # ==============================================================
  RETRY=0
  MAX_RETRY=3
  while [ "$RETRY" -lt "$MAX_RETRY" ]; do
    echo ""
    info "Testando $APP_NAME (tentativa $((RETRY+1))/$MAX_RETRY)..."
    [ "$RETRY" -gt 0 ] && sleep 5

    BASE="http://127.0.0.1:$APP_PORT/"
    OK_ALL=true

    _test_endpoint "${BASE}health"   "Health"    GET "" '"healthy"\|"connected"' || OK_ALL=false
    _test_endpoint "${BASE}"         "Root"      GET "" '"OK"\|"Running"'      || OK_ALL=false
    _test_endpoint "${BASE}auth/login" "Login"   POST \
      "{\"usuario\":\"$ADMIN_EMAIL\",\"senha\":\"$ADMIN_PASS\"}" \
      '"success":true\|"token"' || OK_ALL=false

    if $OK_ALL; then
      info "Todos os testes passaram!"
      break
    fi

    RETRY=$((RETRY+1))
    if [ "$RETRY" -ge "$MAX_RETRY" ]; then
      echo ""
      warn "Testes falharam após $MAX_RETRY tentativas"
      _diagnostic_api
      echo ""
      info "Deseja recriar os containers e tentar novamente? [s/N]: "
      read -r RECRIAR
      case "$RECRIAR" in
        [Ss])
          info "Recriando containers..."
          docker compose -f "$SCRIPT_DIR/docker-compose.yml" down -v 2>/dev/null || true
          docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d --build || {
            error "Falha ao recriar containers. Execute manualmente:"
            echo "  sudo docker compose -f $SCRIPT_DIR/docker-compose.yml up -d --build"
            exit 1
          }
          sleep 5
          _test_endpoint "${BASE}health"   "Health" GET "" '"healthy"\|"connected"' || warn "Health:    FALHA"
          _test_endpoint "${BASE}"         "Root"   GET "" '"OK"\|"Running"'      || warn "Root:      FALHA"
          _test_endpoint "${BASE}auth/login" "Login" POST \
            "{\"usuario\":\"$ADMIN_EMAIL\",\"senha\":\"$ADMIN_PASS\"}" \
            '"success":true\|"token"' || warn "Login:     FALHA"
          ;;
      esac
    else
      warn "Tentando novamente em 5s..."
    fi
  done

  echo ""
  info "Testes concluídos!"
  echo ""
  echo "  Projeto:  $APP_NAME"
  echo "  Admin:    $ADMIN_EMAIL / $ADMIN_PASS"
  echo ""
  info "Comandos úteis:"
  echo "  docker compose logs -f api   (ver logs da API)"
  echo "  docker compose logs -f db    (ver logs do banco)"
  echo "  docker compose restart api   (reiniciar API)"
  echo "  docker compose down          (parar tudo)"
  echo "  curl http://localhost:$APP_PORT/health"
}

# ==============================================================
# menu — menu interativo
# ==============================================================
menu() {
  while :; do
    echo ""
    info "===== Amor Animal API - Gerenciamento ====="
    echo "  1. Instalar"
    echo "  2. Reconfigurar porta"
    echo "  3. Recriar container"
    echo "  4. Liberar portas"
    echo "  5. Ver logs da API"
    echo "  6. Parar containers"
    echo "  7. Desinstalar"
    echo "  8. Migrar banco (tabelas login/home)"
    echo "  0. Sair"
    echo ""
    printf "Escolha: "; read -r OPT
    case "$OPT" in
      1) install_flow; break ;;
      2) reconfig ;;
      3) recreate ;;
      4) free_ports ;;
      5) logs_api ;;
      6) stop_containers ;;
      7) uninstall ;;
      8) migrate_schema; info "Migração concluída." ;;
      0) info "Saindo..."; exit 0 ;;
      *) warn "Opção inválida" ;;
    esac
    echo ""
    printf "Pressione Enter para voltar ao menu..."; read -r _
  done
}


case "${1:-}" in
  install) install_flow ;;
  uninstall) uninstall ;;
  reconfig) reconfig ;;
  recreate) recreate ;;
  free-ports) free_ports ;;
  logs) logs_api ;;
  stop) stop_containers ;;
  migrate) migrate_schema ;;
  menu|"") menu ;;
  *) error "Uso: $0 {install|uninstall|reconfig|recreate|free-ports|logs|stop|migrate|menu}" ;;
esac
