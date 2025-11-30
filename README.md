# Dota 2 Discord Bot

Bot que monitora partidas do Dota 2 e envia notificações no Discord.

## Variáveis de Ambiente Necessárias

- `DISCORD_TOKEN` - Token do bot do Discord
- `CHANNEL_ID` - ID do canal onde enviar notificações
- `PLAYER_ID` - ID do jogador do Dota 2 (padrão: 102374955)
- `CHECK_INTERVAL` - Intervalo em ms (padrão: 600000 = 10 min)

## Uso Local
```bash
npm install
node bot.js
```