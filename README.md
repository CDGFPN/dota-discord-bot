# 🎮 Dota 2 Discord Bot

Bot que monitora partidas do Dota 2 e envia notificações automáticas no Discord com estatísticas detalhadas, incluindo rastreamento de Low Priority. Este especificamente roda localmente apenas para monitorar meu amigo Aldinha que é o rei das silly builds e babyrage.

## ✨ Funcionalidades

- 📊 Notificações automáticas de novas partidas
- 🏆 Estatísticas detalhadas (KDA, GPM, XPM, duração)
- 🎒 Inventário e backpack dos itens
- ⚠️ **Contador de Low Priority** - detecta quando o jogador entra/sai da low priority
- 💾 Estado persistente entre reinicializações
- 🔄 Sistema de retry com rate limit inteligente
- 📡 Health check endpoint para monitoramento

## 🔧 Variáveis de Ambiente

### Obrigatórias

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `DISCORD_TOKEN` | Token do bot do Discord | `MTIzNDU2Nzg5...` |
| `CHANNEL_ID` | ID do canal onde enviar notificações | `1234567890123456789` |
| `PLAYER_ID` | ID do jogador do Dota 2 | `102374955` |

### Opcionais

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `CHECK_INTERVAL` | Intervalo de verificação em ms | `900000` (15 min) |
| `FETCH_TIMEOUT_MS` | Timeout para requisições HTTP | `10000` (10s) |
| `HEALTH_CHECK_PORT` | Porta do endpoint de status | `3000` |
| `TEST_MODE` | Envia última partida no startup | `false` |
| `TEST_MATCH_ID` | Testa com uma partida específica | - |

## 🚀 Uso Local

```bash
# Instalar dependências
npm install

# Configurar variáveis de ambiente
cp .env.example .env
# Edite o arquivo .env com suas credenciais

# Executar o bot
node bot.js
```

## 📝 Arquivo .env.example

```env
DISCORD_TOKEN=seu_token_aqui
CHANNEL_ID=seu_channel_id_aqui
PLAYER_ID=102374955
CHECK_INTERVAL=900000
FETCH_TIMEOUT_MS=10000
HEALTH_CHECK_PORT=3000
TEST_MODE=false
# TEST_MATCH_ID=8123456789
```

## 🎯 Sistema de Low Priority

O bot detecta automaticamente quando o jogador está em Low Priority (Single Draft - game_mode 4):

- **"CAIU NA LOW KK"** - Quando entra na low priority
- **"Lows jogadas: X"** - Contador enquanto continua em low
- **"Saiu da low finalmente"** - Quando completa todas as partidas e sai da low

O contador é persistido no arquivo `bot-state.json` e sobrevive a reinicializações do bot.

## 📊 Monitoramento

O bot expõe um endpoint de status em `/status`:

```bash
curl http://localhost:3000/status
```

Retorna informações sobre:
- Status de conexão do bot
- Última partida verificada
- Contador de low priority atual
- Status da API do OpenDota
- Rate limits

## 🐳 Docker (Opcional)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
CMD ["node", "bot.js"]
```

```bash
docker build -t dota-bot .
docker run -d --env-file .env --name dota-bot dota-bot
```

## 🔍 Modo de Teste

Para testar o bot sem esperar por novas partidas:

```env
# Testa enviando a última partida (uma vez no startup)
TEST_MODE=true

# OU testa com uma partida específica
TEST_MATCH_ID=8123456789
```

## 📦 Dependências

- `discord.js` - Cliente Discord
- `dotenv` - Gerenciamento de variáveis de ambiente
- Node.js 18+

## 🛠️ Estrutura de Arquivos

```
.
├── bot.js              # Código principal do bot
├── bot-state.json      # Estado persistente (gerado automaticamente)
├── .env                # Variáveis de ambiente (não commitado)
├── package.json
└── README.md
```

## ⚙️ Rate Limits da API OpenDota

- **60 requisições por minuto**
- **Limite diário = 3000 requisições** 

O bot gerencia automaticamente os rate limits e aguarda o reset quando necessário.

## 🤝 Como Obter as Credenciais

### Discord Token
1. Acesse [Discord Developer Portal](https://discord.com/developers/applications)
2. Crie uma nova aplicação
3. Vá em "Bot" → "Reset Token" e copie o token
4. Ative as intents necessárias: `Server Members Intent`, `Message Content Intent`

### Channel ID
1. Ative o Modo Desenvolvedor no Discord (Configurações → Avançado)
2. Clique com botão direito no canal desejado → "Copiar ID"

### Player ID
1. Acesse [OpenDota](https://www.opendota.com/)
2. Busque seu perfil Steam
3. O ID aparece na URL: `opendota.com/players/[PLAYER_ID]`

## 📄 Licença

MIT

## 🐛 Troubleshooting

**Bot não conecta:** Verifique se o token do Discord está correto

**Nenhuma partida detectada:** Certifique-se que o PLAYER_ID está correto e que o perfil é público no Dota 2

**Rate limit atingido:** O bot aguardará automaticamente o reset (meia-noite UTC)

**Estado corrompido:** Delete o arquivo `bot-state.json` e reinicie o bot

---

💡 **Dica:** Copie todo o conteúdo deste artifact e salve como `README.md` no diretório do seu projeto!