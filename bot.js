const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const http = require('http');

// Configurações (usando variáveis de ambiente para produção)
const CONFIG = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  CHANNEL_ID: process.env.CHANNEL_ID ,
  PLAYER_ID: process.env.PLAYER_ID,
  CHECK_INTERVAL: parseInt(process.env.CHECK_INTERVAL || '600000'), // 10 minutos padrão
  TEST_MODE: process.env.TEST_MODE === 'true' || false,
  TEST_MATCH_ID: process.env.TEST_MATCH_ID || null,
  PORT: process.env.PORT || 3000,
};

// Cliente Discord
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

// Estatísticas de uso da API
let apiCallsToday = 0;
let lastResetDate = new Date().getDate();

// Função para rastrear chamadas da API
function trackApiCall() {
  const today = new Date().getDate();
  if (today !== lastResetDate) {
    console.log(`📊 Requisições ontem: ${apiCallsToday}`);
    apiCallsToday = 0;
    lastResetDate = today;
  }
  apiCallsToday++;
}

// Armazena o ID da última partida verificada
let lastMatchId = null;
let lastCheckTime = null;

// Função para buscar matches do jogador
async function fetchPlayerMatches(limit = 1) {
  trackApiCall();
  const url = `https://api.opendota.com/api/players/${CONFIG.PLAYER_ID}/matches?limit=${limit}`;
  const response = await fetch(url);
  return response.json();
}

// Função para buscar detalhes completos de uma match
async function fetchMatchDetails(matchId) {
  trackApiCall();
  const response = await fetch(`https://api.opendota.com/api/matches/${matchId}`);
  return response.json();
}

// Cache para heróis (não muda frequentemente)
let heroesCache = null;
let heroesCacheTime = null;

// Função para buscar lista de heróis (com cache de 24h)
async function fetchHeroes() {
  const now = Date.now();
  if (heroesCache && heroesCacheTime && (now - heroesCacheTime < 24 * 60 * 60 * 1000)) {
    console.log('📦 Usando cache de heróis');
    return heroesCache;
  }
  trackApiCall();
  console.log('🔄 Atualizando cache de heróis');
  const response = await fetch('https://api.opendota.com/api/heroes');
  heroesCache = await response.json();
  heroesCacheTime = now;
  return heroesCache;
}

// Cache para itens (não muda frequentemente)
let itemDataCache = null;
let itemCacheTime = null;

// Função para buscar dados de itens (com cache de 24h)
async function fetchItemData() {
  const now = Date.now();
  if (itemDataCache && itemCacheTime && (now - itemCacheTime < 24 * 60 * 60 * 1000)) {
    console.log('📦 Usando cache de itens');
    return itemDataCache;
  }
  trackApiCall();
  trackApiCall(); // 2 chamadas: item_ids e items
  console.log('🔄 Atualizando cache de itens');
  const [itemIds, items] = await Promise.all([
    fetch('https://api.opendota.com/api/constants/item_ids').then(r => r.json()),
    fetch('https://api.opendota.com/api/constants/items').then(r => r.json()),
  ]);
  itemDataCache = { itemIds, items };
  itemCacheTime = now;
  return itemDataCache;
}

// Função para processar inventário
function getReadableInventory(playerData, itemIds, items) {
  const inventory = Object.fromEntries([
    ...Array.from({ length: 6 }, (_, i) => [`item_${i}`, playerData[`item_${i}`]]),
    ...Array.from({ length: 3 }, (_, i) => [`backpack_${i}`, playerData[`backpack_${i}`]]),
  ]);

  const quebrouItens = Object.values(inventory).every(value => value === 0);

  const readableInventory = Object.fromEntries(
    Object.entries(inventory).map(([slot, id]) => {
      if (id === 0) return [slot, null];
      const internalName = itemIds[id];
      const realName = items[internalName]?.dname ?? null;
      return [slot, realName];
    })
  );

  const invItems = Array.from({ length: 6 }, (_, i) => 
    readableInventory[`item_${i}`]
  ).filter(Boolean);
  
  const backpackItems = Array.from({ length: 3 }, (_, i) => 
    readableInventory[`backpack_${i}`]
  ).filter(Boolean);

  return { invItems, backpackItems, quebrouItens };
}

// Função para criar embed da partida
async function createMatchEmbed(matchDetails, playerData, heroes) {
  const hero = heroes.find(h => h.id === playerData.hero_id);
  const { itemIds, items } = await fetchItemData();
  const { invItems, backpackItems, quebrouItens } = getReadableInventory(playerData, itemIds, items);

  const won = playerData.win === 1;
  const kda = `${playerData.kills}/${playerData.deaths}/${playerData.assists}`;
  const duration = Math.floor(matchDetails.duration / 60);

  const embed = new EmbedBuilder()
    .setTitle(`🎮 Nova Partida do Alda!`)
    .setColor(won ? 0x00FF00 : 0xFF0000)
    .setURL(`https://www.opendota.com/matches/${matchDetails.match_id}`)
    .addFields(
      { name: '🏆 Resultado', value: won ? '✅ Vitória' : '❌ Derrota', inline: true },
      { name: '⚔️ Herói', value: hero?.localized_name || 'Desconhecido', inline: true },
      { name: '📊 KDA', value: kda, inline: true },
      { name: '⏱️ Duração', value: `${duration} minutos`, inline: true },
      { name: '💰 GPM', value: `${playerData.gold_per_min}`, inline: true },
      { name: '📈 XPM', value: `${playerData.xp_per_min || 'N/A'}`, inline: true },
    );

  if (invItems.length > 0) {
    embed.addFields({ 
      name: '🎒 Inventário', 
      value: invItems.join(', '),
      inline: false 
    });
  }

  if (backpackItems.length > 0) {
    embed.addFields({ 
      name: '🎁 Backpack', 
      value: backpackItems.join(', '),
      inline: false 
    });
  }

  if (quebrouItens) {
    embed.addFields({ 
      name: '😂', 
      value: '**Quebrou/vendeu todos os itens KKKKK**',
      inline: false 
    });
  }

  embed.setTimestamp(new Date(matchDetails.start_time * 1000));
  embed.setFooter({ text: `Match ID: ${matchDetails.match_id}` });

  if (hero?.img) {
    embed.setThumbnail(`https://cdn.cloudflare.steamstatic.com${hero.img}`);
  }

  return embed;
}

// Função principal de verificação
async function checkForNewMatches() {
  try {
    const now = Date.now();
    lastCheckTime = now;
    
    console.log(`🔍 Verificando novas partidas... (Requisições hoje: ${apiCallsToday})`);
    
    // Se TEST_MATCH_ID estiver definido, testa com essa partida específica
    if (CONFIG.TEST_MATCH_ID) {
      console.log(`🧪 MODO TESTE: Testando com match ID: ${CONFIG.TEST_MATCH_ID}`);
      const matchDetails = await fetchMatchDetails(CONFIG.TEST_MATCH_ID);
      const heroes = await fetchHeroes();
      
      const playerData = matchDetails.players.find(
        p => String(p.account_id) === CONFIG.PLAYER_ID
      );

      if (!playerData) {
        console.log('❌ Jogador não encontrado na partida');
        return;
      }

      const embed = await createMatchEmbed(matchDetails, playerData, heroes);
      const channel = await client.channels.fetch(CONFIG.CHANNEL_ID);
      await channel.send({ embeds: [embed] });
      
      console.log('✅ Teste enviado com sucesso!');
      console.log('⚠️ Desative TEST_MATCH_ID para voltar ao modo normal');
      return;
    }
    
    const matches = await fetchPlayerMatches(1);
    
    if (!matches || matches.length === 0) {
      console.log('❌ Nenhuma partida encontrada');
      return;
    }

    const latestMatch = matches[0];
    
    // Se é a primeira verificação, apenas armazena o ID
    if (lastMatchId === null) {
      lastMatchId = latestMatch.match_id;
      console.log(`✅ Inicializado com match ID: ${lastMatchId}`);
      
      // Modo teste: envia a última partida mesmo sendo a primeira verificação
      if (CONFIG.TEST_MODE) {
        console.log('🧪 MODO TESTE: Enviando última partida...');
        // Não faz return, continua o processamento
      } else {
        return;
      }
    }

    // Verifica se há nova partida
    if (latestMatch.match_id !== lastMatchId || CONFIG.TEST_MODE) {
      console.log(`🆕 Nova partida detectada: ${latestMatch.match_id}`);
      
      // Busca detalhes completos
      const matchDetails = await fetchMatchDetails(latestMatch.match_id);
      const heroes = await fetchHeroes();
      
      // Encontra os dados do jogador
      const playerData = matchDetails.players.find(
        p => String(p.account_id) === CONFIG.PLAYER_ID
      );

      if (!playerData) {
        console.log('❌ Jogador não encontrado na partida');
        return;
      }

      // Cria e envia embed
      const embed = await createMatchEmbed(matchDetails, playerData, heroes);
      const channel = await client.channels.fetch(CONFIG.CHANNEL_ID);
      await channel.send({ embeds: [embed] });

      // Atualiza última partida
      lastMatchId = latestMatch.match_id;
      console.log('✅ Notificação enviada com sucesso!');
      
      // Desativa TEST_MODE após enviar
      if (CONFIG.TEST_MODE) {
        CONFIG.TEST_MODE = false;
        console.log('ℹ️ TEST_MODE desativado automaticamente');
      }
    } else {
      console.log('ℹ️ Nenhuma partida nova');
    }
  } catch (error) {
    console.error('❌ Erro ao verificar partidas:', error);
  }
}

// Eventos do Discord
client.once('ready', () => {
  console.log(`✅ Bot conectado como ${client.user.tag}`);
  console.log(`👀 Monitorando jogador ID: ${CONFIG.PLAYER_ID}`);
  console.log(`⏱️ Intervalo de checagem: ${CONFIG.CHECK_INTERVAL / 1000}s`);
  
  // Se TEST_MATCH_ID estiver definido, só roda uma vez
  if (CONFIG.TEST_MATCH_ID) {
    console.log('🧪 Modo de teste com match específico - executando uma vez');
    checkForNewMatches();
    return;
  }
  
  // Inicia verificação periódica
  checkForNewMatches(); // Primeira verificação imediata
  setInterval(checkForNewMatches, CONFIG.CHECK_INTERVAL);
});

client.on('error', error => {
  console.error('❌ Erro no cliente Discord:', error);
});

// Servidor HTTP para o Render (evita que o serviço durma)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`Bot está rodando!
Status: ${client.user ? 'Online' : 'Conectando...'}
Última verificação: ${lastCheckTime ? new Date(lastCheckTime).toLocaleString('pt-BR') : 'Aguardando...'}
Requisições hoje: ${apiCallsToday}
Última partida: ${lastMatchId || 'N/A'}`);
});

server.listen(CONFIG.PORT, () => {
  console.log(`🌐 Servidor HTTP rodando na porta ${CONFIG.PORT}`);
});

// Inicia o bot
client.login(CONFIG.DISCORD_TOKEN);