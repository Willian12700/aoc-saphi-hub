#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "============================================================"
echo "   STREAM HUB PRO v3.0 - INSTALADOR MOTO G60 (TERMUX)"
echo "============================================================"

# 1. Instalar dependencias nativas ARM64
pkg update -y
pkg install -y nodejs ffmpeg git curl

# 2. Clonar ou atualizar o servidor aoc-saphi-hub
APP_DIR="$HOME/aoc-saphi-hub"
if [ -d "$APP_DIR/.git" ]; then
  echo "[+] Atualizando repositorio existente..."
  cd "$APP_DIR" && git pull origin main
else
  echo "[+] Clonando repositorio..."
  git clone https://github.com/Willian12700/aoc-saphi-hub.git "$APP_DIR"
  cd "$APP_DIR"
fi

# 3. Criar script de execucao continua 24h (auto-restart)
cat << 'EOF' > "$HOME/start_stream_hub.sh"
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock 2>/dev/null || true
cd "$HOME/aoc-saphi-hub"
while true; do
  echo "[$(date)] Iniciando Stream Hub Pro v3.0 na porta 8080..." >> "$HOME/stream_hub.log"
  PORT=8080 TV_WILLIAN_IP=192.168.1.6 TV_MAE_IP=192.168.1.11 node server.js >> "$HOME/stream_hub.log" 2>&1
  echo "[$(date)] Servidor encerrou, reiniciando em 3s..." >> "$HOME/stream_hub.log"
  sleep 3
done
EOF
chmod +x "$HOME/start_stream_hub.sh"

# 4. Configurar auto-start no Termux:Boot (se instalado)
mkdir -p "$HOME/.termux/boot"
cat << 'EOF' > "$HOME/.termux/boot/start_stream_hub.sh"
#!/data/data/com.termux/files/usr/bin/bash
nohup "$HOME/start_stream_hub.sh" >/dev/null 2>&1 &
EOF
chmod +x "$HOME/.termux/boot/start_stream_hub.sh"

# 5. Encerrar instancia antiga e iniciar em segundo plano agora
pkill -f "node server.js" 2>/dev/null || true
nohup "$HOME/start_stream_hub.sh" >/dev/null 2>&1 &
sleep 2

IP=$(ip -4 addr show wlan0 2>/dev/null | grep -oE 'inet [0-9.]+' | awk '{print $2}' | head -n1)
echo ""
echo "============================================================"
echo "  [OK] STREAM HUB PRO v3.0 RODANDO 24H NO MOTO G60!"
echo "  Painel Visual:  http://${IP:-192.168.1.11}:8080/painel"
echo "  Health Check:   http://${IP:-192.168.1.11}:8080/api/health"
echo "  Jarvis Notify:  POST http://${IP:-192.168.1.11}:8080/api/jarvis/notify"
echo "  Jarvis TV Key:  POST http://${IP:-192.168.1.11}:8080/api/tv/key"
echo "  Logs:           tail -f ~/stream_hub.log"
echo "============================================================"
curl -s "http://127.0.0.1:8080/api/health" || true
echo ""
