const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
require("dotenv").config();

// Configurações via .env
const CONFIG = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  CHANNEL_ID: process.env.CHANNEL_ID,
  PLAYER_ID: process.env.PLAYER_ID,
  CHECK_INTERVAL: Number(process.env.CHECK_INTERVAL || 15 * 60 * 1000), // default 15 min
  TEST_MODE: String(process.env.TEST_MODE || "false").toLowerCase() === "true",
  TEST_MATCH_ID: process.env.TEST_MATCH_ID || null,
  LATEST_MATCH: process.env.LATEST_MATCH || null,
};

// Cliente Discord
const client = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

// Armazena o ID da última partida verificada, inicializando com o .env
let lastMatchId = CONFIG.LATEST_MATCH ? String(CONFIG.LATEST_MATCH) : null;

// Função para buscar matches do jogador
async function fetchPlayerMatches(limit = 1) {
	const url = `https://api.opendota.com/api/players/${CONFIG.PLAYER_ID}/matches?limit=${limit}`;
	const response = await fetch(url);
	return response.json();
}

// Função para buscar detalhes completos de uma match
async function fetchMatchDetails(matchId) {
	const response = await fetch(
		`https://api.opendota.com/api/matches/${matchId}`
	);
	return response.json();
}

// Função para buscar lista de heróis
async function fetchHeroes() {
	const response = await fetch("https://api.opendota.com/api/heroes");
	return response.json();
}

// Função para buscar dados de itens
async function fetchItemData() {
	const [itemIds, items] = await Promise.all([
		fetch("https://api.opendota.com/api/constants/item_ids").then((r) =>
			r.json()
		),
		fetch("https://api.opendota.com/api/constants/items").then((r) => r.json()),
	]);
	return { itemIds, items };
}

// Função para processar inventário
function getReadableInventory(playerData, itemIds, items) {
	const inventory = Object.fromEntries([
		...Array.from({ length: 6 }, (_, i) => [
			`item_${i}`,
			playerData[`item_${i}`],
		]),
		...Array.from({ length: 3 }, (_, i) => [
			`backpack_${i}`,
			playerData[`backpack_${i}`],
		]),
	]);

	const quebrouItens = Object.values(inventory).every((value) => value === 0);

	const readableInventory = Object.fromEntries(
		Object.entries(inventory).map(([slot, id]) => {
			if (id === 0) return [slot, null];
			const internalName = itemIds[id];
			const realName = items[internalName]?.dname ?? null;
			return [slot, realName];
		})
	);

	const invItems = Array.from(
		{ length: 6 },
		(_, i) => readableInventory[`item_${i}`]
	).filter(Boolean);

	const backpackItems = Array.from(
		{ length: 3 },
		(_, i) => readableInventory[`backpack_${i}`]
	).filter(Boolean);

	return { invItems, backpackItems, quebrouItens };
}

// Função para criar embed da partida
async function createMatchEmbed(matchDetails, playerData, heroes) {
	const hero = heroes.find((h) => h.id === playerData.hero_id);
	const { itemIds, items } = await fetchItemData();
	const { invItems, backpackItems, quebrouItens } = getReadableInventory(
		playerData,
		itemIds,
		items
	);

	const won = playerData.win === 1;
	const kda = `${playerData.kills}/${playerData.deaths}/${playerData.assists}`;
	const duration = Math.floor(matchDetails.duration / 60);

	const embed = new EmbedBuilder()
		.setTitle(`🎮 Nova Partida do Alda!`)
		.setColor(won ? 0x00ff00 : 0xff0000)
		.setURL(`https://www.opendota.com/matches/${matchDetails.match_id}`)
		.addFields(
			{
				name: "🏆 Resultado",
				value: won ? "✅ Vitória" : "❌ Derrota",
				inline: true,
			},
			{
				name: "⚔️ Herói",
				value: hero?.localized_name || "Desconhecido",
				inline: true,
			},
			{ name: "📊 KDA", value: kda, inline: true },
			{ name: "⏱️ Duração", value: `${duration} minutos`, inline: true },
			{ name: "💰 GPM", value: `${playerData.gold_per_min}`, inline: true },
			{
				name: "📈 XPM",
				value: `${playerData.xp_per_min || "N/A"}`,
				inline: true,
			}
		);

	if (invItems.length > 0) {
		embed.addFields({
			name: "🎒 Inventário",
			value: invItems.join(", "),
			inline: false,
		});
	}

	if (backpackItems.length > 0) {
		embed.addFields({
			name: "🎁 Backpack",
			value: backpackItems.join(", "),
			inline: false,
		});
	}

	if (quebrouItens) {
		embed.addFields({
			name: "😂",
			value: "**Quebrou/vendeu todos os itens KKKKK**",
			inline: false,
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
		console.log("🔍 Verificando novas partidas...");

		// Se TEST_MATCH_ID estiver definido, testa com essa partida específica
		if (CONFIG.TEST_MATCH_ID) {
			console.log(
				`🧪 MODO TESTE: Testando com match ID: ${CONFIG.TEST_MATCH_ID}`
			);
			const matchDetails = await fetchMatchDetails(CONFIG.TEST_MATCH_ID);
			const heroes = await fetchHeroes();

			const playerData = matchDetails.players.find(
				(p) => String(p.account_id) === CONFIG.PLAYER_ID
			);

			if (!playerData) {
				console.log("❌ Jogador não encontrado na partida");
				return;
			}

			const embed = await createMatchEmbed(matchDetails, playerData, heroes);
			const channel = await client.channels.fetch(CONFIG.CHANNEL_ID);
			await channel.send({ embeds: [embed] });

			console.log("✅ Teste enviado com sucesso!");
			console.log("⚠️ Desative TEST_MATCH_ID para voltar ao modo normal");
			return;
		}

		const matches = await fetchPlayerMatches(1);

		if (!matches || matches.length === 0) {
			console.log("❌ Nenhuma partida encontrada");
			return;
		}

		const latestMatch = matches[0];

		// Normaliza IDs para string
		const latestId = String(latestMatch.match_id);

		// Se é a primeira verificação e não há LATEST_MATCH no .env, inicializa e persiste
		if (lastMatchId === null) {
			lastMatchId = latestId;
			console.log(`✅ Inicializado com match ID: ${lastMatchId}`);
			await persistLatestMatch(lastMatchId);

			// Modo teste: envia a última partida mesmo sendo a primeira verificação
			if (!CONFIG.TEST_MODE) return;
		}

		// Verifica se há nova partida comparando com .env/estado atual
		if (latestId !== lastMatchId || CONFIG.TEST_MODE) {
			console.log(`🆕 Nova partida detectada: ${latestMatch.match_id}`);

			// Busca detalhes completos
			const matchDetails = await fetchMatchDetails(latestMatch.match_id);
			const heroes = await fetchHeroes();

			// Encontra os dados do jogador
			const playerData = matchDetails.players.find(
				(p) => String(p.account_id) === CONFIG.PLAYER_ID
			);

			if (!playerData) {
				console.log("❌ Jogador não encontrado na partida");
				return;
			}

			// Cria e envia embed
			const embed = await createMatchEmbed(matchDetails, playerData, heroes);
			const channel = await client.channels.fetch(CONFIG.CHANNEL_ID);
			await channel.send({ embeds: [embed] });

			// Atualiza e persiste última partida
			lastMatchId = latestId;
			await persistLatestMatch(lastMatchId);
			console.log("✅ Notificação enviada com sucesso!");

			// Desativa TEST_MODE após enviar
			if (CONFIG.TEST_MODE) {
				CONFIG.TEST_MODE = false;
				console.log("ℹ️ TEST_MODE desativado automaticamente");
			}
		} else {
			console.log("ℹ️ Nenhuma partida nova");
		}
	} catch (error) {
		console.error("❌ Erro ao verificar partidas:", error);
	}
}

// Eventos do Discord (usa apenas 'ready' para evitar duplicação)
client.once("ready", () => {
	console.log(`✅ Bot conectado como ${client.user.tag}`);
	console.log(`👀 Monitorando jogador ID: ${CONFIG.PLAYER_ID}`);

	// Se TEST_MATCH_ID estiver definido, só roda uma vez
	if (CONFIG.TEST_MATCH_ID) {
		console.log("🧪 Modo de teste com match específico - executando uma vez");
		checkForNewMatches();
		return;
	}

	// Inicia verificação periódica
	checkForNewMatches(); // Primeira verificação imediata
	setInterval(checkForNewMatches, CONFIG.CHECK_INTERVAL);
});

client.on("error", (error) => {
	console.error("❌ Erro no cliente Discord:", error);
});

// Persistência do LATEST_MATCH no arquivo .env
const fs = require("fs");
const path = require("path");
const ENV_PATH = path.resolve(__dirname, ".env");

function writeEnv(updated) {
	const entries = Object.entries(updated)
		.filter(([, v]) => v !== undefined && v !== null)
		.map(([k, v]) => `${k}=${v}`);
	fs.writeFileSync(ENV_PATH, entries.join("\n"), { encoding: "utf8" });
}

function parseEnvFile(content) {
	const out = {};
	for (const line of content.split(/\r?\n/)) {
		if (!line || line.trim().startsWith("#")) continue;
		const idx = line.indexOf("=");
		if (idx === -1) continue;
		const key = line.slice(0, idx).trim();
		const val = line.slice(idx + 1);
		out[key] = val;
	}
	return out;
}

async function persistLatestMatch(latest) {
	try {
		let current = {};
		if (fs.existsSync(ENV_PATH)) {
			const content = fs.readFileSync(ENV_PATH, "utf8");
			current = parseEnvFile(content);
		}
		if (current.LATEST_MATCH === String(latest)) return; // nothing to do
		current.LATEST_MATCH = String(latest);
		writeEnv({
			...current,
		});
		console.log(`📝 LATEST_MATCH atualizado no .env: ${latest}`);
	} catch (e) {
		console.error("❌ Falha ao persistir LATEST_MATCH no .env:", e);
	}
}

// Inicia o bot
client.login(CONFIG.DISCORD_TOKEN);
