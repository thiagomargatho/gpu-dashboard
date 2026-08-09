#!/usr/bin/env bash
#
# Instalador do gpu-dashboard.
#
# Rode como USUARIO COMUM (nao com sudo na frente): o script pede sudo apenas
# nas etapas do systemd. Rodar tudo como root deixaria node_modules e o log
# pertencendo ao root, e o servico roda como usuario comum.
#
#   bash install.sh
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="gpu-dashboard"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
RUN_USER="$(id -un)"
RUN_GROUP="$(id -gn)"

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn()  { printf '  \033[33m!\033[0m %s\n' "$*"; }
fail()  { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; }
die()   { fail "$*"; exit 1; }

if [ "$(id -u)" -eq 0 ]; then
  die "nao rode como root. Use: bash install.sh (o script chama sudo quando precisar)"
fi

# ---------------------------------------------------------------- 1. dependencias
bold "1/6  Verificando dependencias"

command -v node >/dev/null || die "node nao encontrado. Instale com: sudo apt install nodejs"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "node $NODE_MAJOR e antigo demais — precisa de 18+ (fetch e AbortSignal.timeout)"
ok "node $(node -v)"

command -v npm >/dev/null || die "npm nao encontrado. Instale com: sudo apt install npm"
ok "npm $(npm -v)"

command -v systemctl >/dev/null || die "systemd nao encontrado — este instalador depende dele"
ok "systemd presente"

if command -v nvidia-smi >/dev/null; then
  # A saida vai para /dev/null porque uma placa caida escreve no stderr e sai 0.
  if nvidia-smi --query-gpu=index --format=csv,noheader >/dev/null 2>&1; then
    GPU_COUNT="$(nvidia-smi --query-gpu=index --format=csv,noheader 2>/dev/null | wc -l)"
    ok "nvidia-smi responde — $GPU_COUNT GPU(s) acessivel(is) ao driver"
  else
    warn "nvidia-smi existe mas nao respondeu. A dashboard sobe e mostra N/A nas GPUs."
  fi
else
  warn "nvidia-smi nao encontrado. A dashboard sobe, mas sem dados de GPU."
fi

OLLAMA_URL="http://$(node -p "require('$DIR/config.json').ollama.host"):$(node -p "require('$DIR/config.json').ollama.port")"
if curl -fsS -m 3 "$OLLAMA_URL/api/version" >/dev/null 2>&1; then
  ok "Ollama respondendo em $OLLAMA_URL"
else
  warn "Ollama nao respondeu em $OLLAMA_URL — a dashboard marca OFFLINE ate ele voltar"
fi

PORT="$(node -p "require('$DIR/config.json').port")"

# A versao de usuario (systemctl --user, sem sudo) segura a mesma porta. Se ela
# estiver no ar, o servico de sistema nao consegue subir — desligamos aqui, ja
# que a de sistema e a mais completa das duas.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
if systemctl --user is-enabled --quiet "$SERVICE_NAME" 2>/dev/null \
  || systemctl --user is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  warn "existe uma versao de USUARIO do $SERVICE_NAME — sera desativada em favor da de sistema"
  systemctl --user disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
  sleep 2
  ok "versao de usuario desativada"
fi

if ss -tln 2>/dev/null | grep -qE "[:.]${PORT}\b"; then
  if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    # Ja e o proprio servico: o restart mais adiante resolve.
    ok "porta $PORT ocupada pelo proprio $SERVICE_NAME (sera reiniciado)"
  elif curl -fsS -m 2 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q '"gpu_count"'; then
    # Instancia avulsa (`npm start` ou teste manual) segurando a porta.
    # Encerramos so o que roda a partir DESTE diretorio.
    warn "porta $PORT ocupada por uma instancia avulsa do gpu-dashboard, fora do systemd"
    for pid in $(pgrep -x node); do
      if grep -qa "server/index.js" "/proc/$pid/cmdline" 2>/dev/null \
        && [ "$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" = "$DIR" ]; then
        kill "$pid" 2>/dev/null && ok "instancia avulsa encerrada (pid $pid)"
      fi
    done
    sleep 2
    ss -tln 2>/dev/null | grep -qE "[:.]${PORT}\b" \
      && die "a porta $PORT continua ocupada. Verifique com: ss -tlnp | grep $PORT"
    ok "porta $PORT liberada"
  else
    die "porta $PORT ja esta em uso por outro processo. Troque 'port' em config.json"
  fi
else
  ok "porta $PORT livre"
fi

# ---------------------------------------------------------------- 2. dependencias do frontend
bold "2/6  Instalando dependencias do frontend"
if [ -f "$DIR/web/package-lock.json" ]; then
  npm --prefix "$DIR/web" ci --no-audit --no-fund
else
  npm --prefix "$DIR/web" install --no-audit --no-fund
fi
ok "dependencias instaladas ($(ls "$DIR/web/node_modules" | wc -l) pacotes)"

# ---------------------------------------------------------------- 3. build
bold "3/6  Compilando o frontend"
npm --prefix "$DIR/web" run build
[ -f "$DIR/web/dist/index.html" ] || die "build nao gerou web/dist/index.html"
ok "build em web/dist ($(du -sh "$DIR/web/dist" | cut -f1))"

# ---------------------------------------------------------------- 4. backend
bold "4/6  Preparando o backend"
mkdir -p "$DIR/logs"
[ -f "$DIR/config.json" ] || die "config.json ausente"
node -e "JSON.parse(require('fs').readFileSync('$DIR/config.json','utf8'))" \
  || die "config.json nao e um JSON valido"
ok "config.json valido, diretorio de logs pronto"

# ---------------------------------------------------------------- 5. systemd
bold "5/6  Instalando o servico systemd (pede sudo)"

# A unit e gerada aqui, e nao copiada, para que os caminhos e o usuario batam
# com onde o projeto realmente esta — inclusive se voce mover o diretorio.
TMP_UNIT="$(mktemp)"
trap 'rm -f "$TMP_UNIT"' EXIT
cat > "$TMP_UNIT" <<EOF
[Unit]
Description=GPU Dashboard - monitoramento do servidor, das GPUs e do Ollama
Documentation=file:$DIR/README.md
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_GROUP
WorkingDirectory=$DIR
ExecStart=$(command -v node) server/index.js
Environment=NODE_ENV=production

Restart=always
RestartSec=5

StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

# A dashboard so LE o sistema: nao precisa de privilegio algum.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictNamespaces=true
LockPersonality=true

# ProtectHome desligado porque o projeto mora em /home. A escrita e liberada
# so no log e no config.json — o codigo-fonte fica somente-leitura.
ProtectHome=false
ReadWritePaths=$DIR/logs
ReadWritePaths=$DIR/config.json

[Install]
WantedBy=multi-user.target
EOF

sudo install -m 0644 "$TMP_UNIT" "$UNIT_PATH"
sudo systemctl daemon-reload
ok "unit instalada em $UNIT_PATH"

# ---------------------------------------------------------------- 6. subir
bold "6/6  Subindo o servico"
sudo systemctl enable "$SERVICE_NAME" >/dev/null 2>&1
sudo systemctl restart "$SERVICE_NAME"

for _ in $(seq 1 15); do
  if curl -fsS -m 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS -m 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
  fail "o servico nao respondeu em 15s. Diagnostico:"
  systemctl status "$SERVICE_NAME" --no-pager -l | head -20
  journalctl -u "$SERVICE_NAME" -n 30 --no-pager
  exit 1
fi

HEALTH="$(curl -fsS "http://127.0.0.1:$PORT/api/health")"
ok "servico ativo — $HEALTH"

IP="$(hostname -I | tr ' ' '\n' | grep -E '^192\.168\.|^10\.' | head -1)"
[ -n "$IP" ] || IP="$(hostname -I | awk '{print $1}')"

echo
bold "Pronto."
echo "  URL na LAN:   http://$IP:$PORT"
echo "  Local:        http://127.0.0.1:$PORT"
echo
echo "  Status:       systemctl status $SERVICE_NAME"
echo "  Logs:         journalctl -u $SERVICE_NAME -f"
echo "  Log proprio:  tail -f $DIR/logs/gpu-dashboard.log"
echo "  Parar:        sudo systemctl stop $SERVICE_NAME"
echo "  Desinstalar:  sudo systemctl disable --now $SERVICE_NAME && sudo rm $UNIT_PATH"
