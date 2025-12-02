# 🎮 Dota 2 Discord Bot

Bot que monitora partidas do Dota 2 e envia notificações automáticas no Discord com estatísticas detalhadas, incluindo rastreamento de Low Priority. Este especificamente roda localmente apenas para monitorar meu amigo Aldinha que é o rei das silly builds e babyrage.

## ✨ Funcionalidades

- 📊 Notificações automáticas de novas partidas
- 🏆 Estatísticas detalhadas (KDA, GPM, XPM, duração)
- 🎒 Inventário visual em grid 3x3 com imagens dos itens
- ⚠️ **Sistema de Low Priority** com tracking de streaks e recordes
- 😂 Detecção automática quando quebra/vende todos os itens
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
| `HEALTH_CHECK_PORT` | Porta do endpoint de status | `3001` |
| `TEST_MATCH_ID` | Preview visual de uma partida | - |
| `FORCE_SEND_TEST_MATCH` | Testa e envia uma partida no canal | - |

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
HEALTH_CHECK_PORT=3001
# TEST_MATCH_ID=8123456789
# FORCE_SEND_TEST_MATCH=8123456789
```

## 🎯 Sistema de Low Priority

O bot detecta automaticamente quando o jogador está em Low Priority (Single Draft - game_mode 4) e rastreia:

### Mensagens do Bot

- **"CAIU NA LOW KK"** - Quando entra na low priority pela primeira vez
- **Streak atual** - Contador de partidas consecutivas em low
- **Melhor streak** - Recorde pessoal de partidas em low
- **"NOVO RECORDE DE LOW STREAK"** - Quando bate o recorde anterior
- **"Saiu da low finalmente"** - Quando completa e sai da low, mostrando quantas partidas foram necessárias
- **"Quebrou/vendeu todos os itens KKKKK"** - Detecção de babyrage quando todos os itens = 0

### Estado Persistente

O arquivo `bot-state.json` armazena:
```json
{
  "lastMatchId": "8123456789",
  "lastGameMode": 4,
  "bestLowPriorityStreak": 5,
  "currentLowPriorityStreak": 3
}
```

O estado sobrevive a reinicializações do bot, mantendo o histórico de streaks.

## 📊 Monitoramento

O bot expõe um endpoint de status em `/status`:

```bash
curl http://localhost:3001/status
```

Retorna informações sobre:
- Status de conexão do bot
- Última partida verificada
- Último game mode detectado
- Melhor streak de low priority
- Streak atual de low priority
- Se está em processo de verificação
- Se está aguardando reset de rate limit
- Status da API do OpenDota

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

### Preview Visual (não envia no Discord)
```env
TEST_MATCH_ID=8123456789
```
- Gera o embed completo no console
- Salva a imagem de itens como `preview_itens_[MATCH_ID].png`
- Mostra links para OpenDota e Dotabuff
- **NÃO modifica** o `bot-state.json`
- **NÃO envia** mensagem no Discord

### Teste com Envio Real
```env
FORCE_SEND_TEST_MATCH=8123456789
```
- Faz tudo do preview visual
- **ENVIA** a mensagem no canal do Discord
- Útil para testar a integração completa
- **NÃO modifica** o `bot-state.json`

**Nota:** Remova essas variáveis do `.env` para voltar ao modo normal de monitoramento.

## 📦 Dependências

- `discord.js` - Cliente Discord
- `canvas` - Geração de imagens para inventário
- `dotenv` - Gerenciamento de variáveis de ambiente
- Node.js 18+

## 🛠️ Estrutura de Arquivos

```
.
├── bot.js                    # Código principal do bot
├── bot-state.json            # Estado persistente (auto-gerado)
├── preview_itens_*.png       # Imagens de teste (geradas em modo TEST)
├── .env                      # Variáveis de ambiente (não commitado)
├── .env.example              # Template de variáveis
├── package.json
└── README.md
```

## ⚙️ Rate Limits da API OpenDota

- **60 requisições por minuto**
- **Limite diário variável** (geralmente em torno de 3000)

O bot gerencia automaticamente os rate limits:
- Monitora headers `x-rate-limit-remaining-minute` e `x-rate-limit-remaining-day`
- Aguarda automaticamente até meia-noite UTC quando atinge o limite diário
- Exibe warnings quando restam menos de 100 requisições no dia
- Continua verificações automaticamente após o reset

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

**Rate limit atingido:** O bot aguardará automaticamente o reset (meia-noite UTC) e retomará as verificações

**Estado corrompido:** Delete o arquivo `bot-state.json` e reinicie o bot (perderá histórico de streaks)

**Imagem de itens não aparece:** Certifique-se que a biblioteca `canvas` está instalada corretamente (`npm install canvas`)

**Streaks incorretas:** Verifique o `bot-state.json` - você pode editar manualmente os valores de `bestLowPriorityStreak` e `currentLowPriorityStreak`

---

💡 **Dica:** Copie todo o conteúdo deste artifact e salve como `README.md` no diretório do seu projeto!