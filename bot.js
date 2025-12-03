const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { AttachmentBuilder } = require("discord.js");
const { createCanvas, loadImage } = require("canvas"); // npm install canvas
require("dotenv").config();

// Configurações via .env
const CONFIG = {
	DISCORD_TOKEN: process.env.DISCORD_TOKEN,
	CHANNEL_ID: process.env.CHANNEL_ID,
	PLAYER_ID: process.env.PLAYER_ID,
	CHECK_INTERVAL: Number(process.env.CHECK_INTERVAL) || 900000,
	TEST_MATCH_ID: process.env.TEST_MATCH_ID || null,
	FORCE_SEND_TEST_MATCH: process.env.FORCE_SEND_TEST_MATCH || null,
	FETCH_TIMEOUT_MS: Number(process.env.FETCH_TIMEOUT_MS || 10000),
	HEALTH_CHECK_PORT: Number(process.env.HEALTH_CHECK_PORT || 3001),
};

// Cliente Discord
const client = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

// Estado persistente
const STATE_FILE = path.resolve(__dirname, "bot-state.json");

function loadState() {
	if (!fs.existsSync(STATE_FILE)) {
		return {
			lastMatchId: null,
			lastGameMode: null,
			bestLowPriorityStreak: 0,
			currentLowPriorityStreak: 0,
		};
	}
	try {
		const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
		if (state.lastGameMode === undefined) state.lastGameMode = null;
		if (state.bestLowPriorityStreak === undefined)
			state.bestLowPriorityStreak = 0;
		if (state.currentLowPriorityStreak === undefined)
			state.currentLowPriorityStreak = 0;
		return state;
	} catch (e) {
		console.error("⚠️ Erro ao ler estado, iniciando limpo:", e.message);
		return {
			lastMatchId: null,
			lastGameMode: null,
			bestLowPriorityStreak: 0,
			currentLowPriorityStreak: 0,
		};
	}
}

function saveState(state) {
	try {
		fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
		console.log(
			`💾 Estado salvo: lastMatchId=${state.lastMatchId}, bestStreak=${state.bestLowPriorityStreak}, currentStreak=${state.currentLowPriorityStreak}`
		);
	} catch (e) {
		console.error("❌ Erro ao salvar estado:", e.message);
	}
}

let state = loadState();
let lastMatchId = state.lastMatchId;
let isChecking = false;
let rateLimitWaitTimeout = null;

// Constante para game_mode de Single Draft (Low Priority)
const GAME_MODE_SINGLE_DRAFT = 4;

// Utilidades para fetch com retry/timeout
function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeFetchJson(
	url,
	options = {},
	{ retries = 3, backoffMs = 1000 } = {}
) {
	for (let attempt = 1; attempt <= retries; attempt++) {
		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(),
			CONFIG.FETCH_TIMEOUT_MS
		);
		try {
			const res = await fetch(url, { ...options, signal: controller.signal });
			clearTimeout(timeout);
			if (!res.ok) {
				let body;
				try {
					body = await res.json();
				} catch (_) {
					body = await res.text();
				}
				return { error: `http ${res.status}`, details: body };
			}
			return res.json();
		} catch (err) {
			clearTimeout(timeout);
			const finalAttempt = attempt === retries;
			console.error(
				`⚠️ Falha ao requisitar ${url} (tentativa ${attempt}/${retries}):`,
				err?.message || err
			);
			if (finalAttempt) {
				console.error("⛔ Erro persistente ao acessar a API.");
				return { error: "network_error", details: err?.message };
			}
			await delay(backoffMs * attempt);
		}
	}
}

// Função para buscar matches do jogador
async function fetchPlayerMatches() {
	const url = `https://api.opendota.com/api/players/${CONFIG.PLAYER_ID}/recentMatches`;
	const retries = 3;
	for (let attempt = 1; attempt <= retries; attempt++) {
		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(),
			CONFIG.FETCH_TIMEOUT_MS
		);
		try {
			const res = await fetch(url, { signal: controller.signal });
			clearTimeout(timeout);
			const headersObj = {};
			try {
				res.headers.forEach((value, key) => {
					headersObj[key.toLowerCase()] = value;
				});
			} catch (_) {}
			if (!res.ok) {
				let body;
				try {
					body = await res.json();
				} catch (_) {
					body = await res.text();
				}
				const errorMsg = body && body.error ? body.error : `http ${res.status}`;
				return {
					data: null,
					error: errorMsg,
					details: body,
					headers: headersObj,
					status: res.status,
				};
			}
			const data = await res.json();
			return { data, headers: headersObj, status: res.status };
		} catch (err) {
			clearTimeout(timeout);
			console.error(
				`⚠️ Falha ao requisitar ${url} (tentativa ${attempt}/${retries}):`,
				err?.message || err
			);
			if (attempt === retries) {
				console.error("⛔ Erro persistente ao acessar a API.");
				return { data: null, error: "network_error", details: err?.message };
			}
			await delay(1000 * attempt);
		}
	}
}

// Função para buscar detalhes completos de uma match
async function fetchMatchDetails(matchId) {
	return safeFetchJson(`https://api.opendota.com/api/matches/${matchId}`);
}

// Função para buscar lista de heróis
async function fetchHeroes() {
	return safeFetchJson("https://api.opendota.com/api/constants/heroes");
}

// Função para buscar dados de itens
async function fetchItemData() {
	const [itemIds, items] = await Promise.all([
		safeFetchJson("https://api.opendota.com/api/constants/item_ids"),
		safeFetchJson("https://api.opendota.com/api/constants/items"),
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

// Função para gerar grid 3x3 de itens (6 principais + 3 backpack)
async function generateItemsImage(playerData, itemIds, items) {
	const ITEM_SIZE = 46;
	const PADDING = 8;
	const GRID_SIZE = ITEM_SIZE + PADDING * 2;
	const canvas = createCanvas(GRID_SIZE * 3, GRID_SIZE * 3);
	const ctx = canvas.getContext("2d");

	// Fundo escuro
	ctx.fillStyle = "#111114";
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	const slots = [
		"item_0",
		"item_1",
		"item_2",
		"item_3",
		"item_4",
		"item_5",
		"backpack_0",
		"backpack_1",
		"backpack_2",
	];

	for (let i = 0; i < slots.length; i++) {
		const slotName = slots[i];
		const itemId = playerData[slotName];
		const col = i % 3;
		const row = Math.floor(i / 3);
		const x = col * GRID_SIZE + PADDING;
		const y = row * GRID_SIZE + PADDING;

		// Slot vazio
		// Fundo do slot
		ctx.fillStyle = "#1e1f23";
		ctx.fillRect(x - 6, y - 6, ITEM_SIZE + 12, ITEM_SIZE + 12);

		if (!itemId || itemId === 0) {
			// Slot vazio
			ctx.fillStyle = "#444";
			ctx.font = "30px Arial";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText("—", x + ITEM_SIZE / 2, y + ITEM_SIZE / 2);
			continue;
		}

		const internalName = itemIds[itemId];
		const itemInfo = items[internalName];
		if (!itemInfo?.img) continue;

		try {
			const img = await loadImage(
				`https://cdn.cloudflare.steamstatic.com${itemInfo.img}`
			);
			ctx.drawImage(img, x, y, ITEM_SIZE, ITEM_SIZE);
		} catch (e) {
			// Se falhar em carregar a imagem
			ctx.fillStyle = "#f04747";
			ctx.font = "24px Arial";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText("?");
		}
	}

	// // Item neutro (canto inferior direito)
	// if (playerData.item_neutral && playerData.item_neutral !== 0) {
	// 	const neutralId = playerData.item_neutral;
	// 	const internal = itemIds[neutralId];
	// 	const neutralInfo = items[internal];
	// 	if (neutralInfo?.img) {
	// 		try {
	// 			const img = await loadImage(
	// 				`https://cdn.cloudflare.steamstatic.com${neutralInfo.img}`
	// 			);
	// 			const nx = 2 * GRID_SIZE + PADDING;
	// 			const ny = 2 * GRID_SIZE + PADDING;
	// 			ctx.fillStyle = "#1e1f23";
	// 			ctx.fillRect(nx - 6, ny - 6, ITEM_SIZE + 12, ITEM_SIZE + 12);
	// 			ctx.drawImage(img, nx, ny, ITEM_SIZE, ITEM_SIZE);
	// 			ctx.strokeStyle = "#ffeb3b";
	// 			ctx.lineWidth = 4;
	// 			ctx.strokeRect(nx - 6, ny - 6, ITEM_SIZE + 12, ITEM_SIZE + 12);
	// 		} catch (e) {}
	// 	}
	// }

	return canvas.toBuffer("image/png");
}

// Função para determinar status de Low Priority
function getLowPriorityStatus(currentGameMode, previousGameMode) {
	const isCurrentLow = currentGameMode === GAME_MODE_SINGLE_DRAFT;
	const wasPreviousLow = previousGameMode === GAME_MODE_SINGLE_DRAFT;

	let statusMessage = null;
	let newRecordMessage = null;
	let showStreaks = false;
	let exitCount = 0;

	// Entrou na low (não estava antes, mas agora está)
	if (isCurrentLow && !wasPreviousLow && previousGameMode !== null) {
		statusMessage = "CAIU NA LOW KK";
		state.currentLowPriorityStreak = 1;
		showStreaks = true;

		// Se já bateu o recorde com apenas 1 partida (caso o recorde seja 0)
		if (state.currentLowPriorityStreak > state.bestLowPriorityStreak) {
			state.bestLowPriorityStreak = state.currentLowPriorityStreak;
			newRecordMessage = "NOVO RECORDE DE LOW STREAK";
		}
	}
	// Continua na low
	else if (isCurrentLow && wasPreviousLow) {
		state.currentLowPriorityStreak++;
		showStreaks = true;

		// Verifica se bateu novo recorde
		if (state.currentLowPriorityStreak > state.bestLowPriorityStreak) {
			state.bestLowPriorityStreak = state.currentLowPriorityStreak;
			newRecordMessage = "NOVO RECORDE DE LOW STREAK";
		}
	}
	// Saiu da low (estava antes, mas agora não está mais)
	else if (!isCurrentLow && wasPreviousLow) {
		statusMessage = "Saiu da low finalmente";
		exitCount = state.currentLowPriorityStreak;

		// Atualiza o recorde se necessário antes de zerar
		if (state.currentLowPriorityStreak > state.bestLowPriorityStreak) {
			state.bestLowPriorityStreak = state.currentLowPriorityStreak;
		}

		// Zera a streak atual
		state.currentLowPriorityStreak = 0;
		showStreaks = false;
	}
	// Primeira partida detectada e já está em low
	else if (isCurrentLow && previousGameMode === null) {
		state.currentLowPriorityStreak = 1;
		showStreaks = true;

		if (state.currentLowPriorityStreak > state.bestLowPriorityStreak) {
			state.bestLowPriorityStreak = state.currentLowPriorityStreak;
			newRecordMessage = "NOVO RECORDE DE LOW STREAK";
		}
	}

	return { statusMessage, newRecordMessage, showStreaks, exitCount };
}

// Função para criar embed da partida
async function createMatchEmbed(matchDetails, playerData, heroes) {
	const hero = heroes[playerData.hero_id];
	const { itemIds, items } = await fetchItemData();
	const { invItems, backpackItems, quebrouItens } = getReadableInventory(
		playerData,
		itemIds,
		items
	);

	const won = playerData.win === 1;
	const kda = `${playerData.kills}/${playerData.deaths}/${playerData.assists}`;
	const duration = new Date(matchDetails.duration * 1000)
		.toISOString()
		.slice(14, 19);

	// Processa status de Low Priority
	const currentGameMode = matchDetails.game_mode;
	const { statusMessage, newRecordMessage, showStreaks, exitCount } =
		getLowPriorityStatus(currentGameMode, state.lastGameMode);

	// Atualiza o lastGameMode
	state.lastGameMode = currentGameMode;

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
			{ name: "⏱️ Duração", value: `${duration}`, inline: true },
			{ name: "💰 GPM", value: `${playerData.gold_per_min}`, inline: true },
			{
				name: "📈 XPM",
				value: `${playerData.xp_per_min || "N/A"}`,
				inline: true,
			}
		);

	// Adiciona status de Low Priority se houver mensagem
	if (statusMessage) {
		let fieldName, fieldValue;
		if (statusMessage === "Saiu da low finalmente") {
			fieldName = statusMessage;
			fieldValue = `Partidas jogadas para sair da low: ${exitCount}`;
		} else {
			fieldName = "⚠️ Low Priority";
			fieldValue = newRecordMessage
				? `${statusMessage}\n${newRecordMessage}`
				: statusMessage;
		}
		embed.addFields({
			name: fieldName,
			value: fieldValue,
			inline: false,
		});
	}

	// Adiciona título de Low Priority se estiver na low e não houver mensagem específica
	if (showStreaks && !statusMessage) {
		embed.addFields({
			name: "⚠️ Low Priority",
			value: "\u200B",
			inline: false,
		});
	}

	// Só mostra streaks se estiver na low
	if (showStreaks) {
		embed.addFields(
			{
				name: `Melhor low streak: ${state.bestLowPriorityStreak}`,
				value: "\u200B",
				inline: true,
			},
			{
				name: `Low streak atual: ${state.currentLowPriorityStreak}`,
				value: "\u200B",
				inline: true,
			}
		);
	}

	// Mostra mensagem de novo recorde se houver
	if (newRecordMessage) {
		embed.addFields({
			name: newRecordMessage,
			value: "\u200B",
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
	if (invItems.length > 0 || backpackItems.length > 0) {
		try {
			const itemsBuffer = await generateItemsImage(playerData, itemIds, items);
			const attachment = new AttachmentBuilder(itemsBuffer, {
				name: "itens.png",
			});
			embed.setImage("attachment://itens.png");
			return { embed, attachment };
		} catch (err) {
			console.error("Erro ao gerar imagem de itens:", err);
			// fallback: mostra texto se a imagem falhar
			if (invItems.length > 0) {
				embed.addFields({
					name: "Inventário",
					value: invItems.join(", "),
					inline: false,
				});
			}
			if (backpackItems.length > 0) {
				embed.addFields({
					name: "Backpack",
					value: backpackItems.join(", "),
					inline: false,
				});
			}
			return { embed, attachment: null };
		}
	}

	return { embed, attachment: null };
}

// Função para calcular tempo até próximo reset (midnight UTC)
function calculateTimeUntilReset() {
	const now = new Date();
	const nextMidnight = new Date(now);
	nextMidnight.setUTCHours(24, 0, 0, 0);
	return nextMidnight - now;
}

// Função principal de verificação
async function checkForNewMatches() {
	if (isChecking) {
		console.log(
			"⏳ Verificação anterior ainda em andamento. Aguardando próxima janela."
		);
		return;
	}
	isChecking = true;
	try {
		const now = new Date();
		const time = `${now.getHours().toString().padStart(2, "0")}:${now
			.getMinutes()
			.toString()
			.padStart(2, "0")}`;

		console.log(`🔍 Verificando novas partidas (${time})`);

		// Se TEST_MATCH_ID estiver definido, testa com essa partida específica
		if (CONFIG.TEST_MATCH_ID || CONFIG.FORCE_SEND_TEST_MATCH) {
			const testMatchId = CONFIG.TEST_MATCH_ID || CONFIG.FORCE_SEND_TEST_MATCH;
			const previewOnly =
				!!CONFIG.TEST_MATCH_ID && !CONFIG.FORCE_SEND_TEST_MATCH;

			console.log(
				previewOnly
					? `MODO TESTE VISUAL para a match ${testMatchId}`
					: `MODO TESTE COM ENVIO REAL para a match ${testMatchId}`
			);
			console.log("bot-state.json NÃO será modificado em nenhum dos casos.\n");

			// Busca detalhes da partida
			const matchDetails = await fetchMatchDetails(testMatchId);
			if (matchDetails.error) {
				console.error(
					"Erro ao buscar detalhes da partida:",
					matchDetails.error
				);
				isChecking = false;
				return;
			}

			const heroes = await fetchHeroes();

			const playerData = matchDetails.players.find(
				(p) => String(p.account_id) === CONFIG.PLAYER_ID
			);
			if (!playerData) {
				console.log("Jogador não encontrado nessa partida");
				isChecking = false;
				return;
			}

			// Gera o embed + imagem exatamente como seria no modo real
			const { embed, attachment } = await createMatchEmbed(
				matchDetails,
				playerData,
				heroes
			);

			// PREVIEW BONITINHO NO CONSOLE

			console.log(
				"\nEMBED QUE " + (previewOnly ? "SERIA" : "FOI") + " ENVIADO:"
			);
			console.log("════════════════════════════════");
			console.log(`Título: ${embed.data.title}`);
			console.log(
				`Cor: ${
					embed.data.color === 0x00ff00
						? "Verde (Vitória)"
						: "Vermelho (Derrota)"
				}`
			);
			console.log(`URL: ${embed.data.url}`);
			embed.data.fields?.forEach((field) => {
				console.log(`• ${field.name}: ${field.value}`);
			});
			console.log(`Thumbnail: ${embed.data.thumbnail?.url || "nenhum"}`);
			console.log(`Imagem de itens: ${attachment ? "Sim" : "Não"}`);
			console.log("════════════════════════════════\n");

			// SALVA IMAGEM DE ITENS LOCALMENTE
			if (attachment) {
				try {
					const { itemIds, items } = await fetchItemData();
					const itemsBuffer = await generateItemsImage(
						playerData,
						itemIds,
						items
					);
					const filename = `preview_itens_${testMatchId}.png`;
					require("fs").writeFileSync(filename, itemsBuffer);
					console.log(`Imagem de itens salva → ${filename}\n`);
				} catch (e) {
					console.error("Falha ao salvar imagem de itens:", e.message);
				}
			}

			// ENVIA NO CANAL (apenas se quiser)
			if (!previewOnly) {
				try {
					const channel = await client.channels.fetch(CONFIG.CHANNEL_ID);
					await channel.send({
						embeds: [embed],
						files: attachment ? [attachment] : [],
					});
					console.log("MENSAGEM ENVIADA NO CANAL COM SUCESSO!");
				} catch (err) {
					console.error("Erro ao enviar mensagem no Discord:", err.message);
				}
			} else {
				console.log("Mensagem NÃO enviada (modo preview only)");
			}

			// Links úteis
			console.log("\nLinks da partida:");
			console.log(`OpenDota : https://www.opendota.com/matches/${testMatchId}`);
			console.log(
				`Dotabuff : https://www.dotabuff.com/matches/${testMatchId}\n`
			);

			console.log("Teste finalizado!");
			if (previewOnly) {
				console.log(
					"→ Remova TEST_MATCH_ID do .env para voltar ao modo normal"
				);
			} else {
				console.log(
					"→ Remova FORCE_SEND_TEST_MATCH do .env para voltar ao modo normal"
				);
			}

			isChecking = false;
			return;
		}

		const {
			data: matches,
			headers: respHeaders,
			status: respStatus,
			error: respError,
		} = await fetchPlayerMatches();

		// Loga headers relevantes (rate limit)
		if (respHeaders) {
			const remaining = {
				minute: respHeaders["x-rate-limit-remaining-minute"],
				day: respHeaders["x-rate-limit-remaining-day"],
			};
			console.log(
				`📊 Rate limits - Minuto: ${remaining.minute || "?"}/60 | Dia: ${
					remaining.day || "?"
				}`
			);

			// Warning se está chegando no limite
			if (
				remaining.day &&
				Number(remaining.day) < 100 &&
				Number(remaining.day) > 0
			) {
				console.warn(
					`⚠️ Aviso: Apenas ${remaining.day} requisições restantes hoje!`
				);
			}
		}

		// Verifica erro de limite diário/ratelimit
		if (respError) {
			console.error(`❌ Erro da API OpenDota: ${respError}`);
			if (
				String(respError).toLowerCase().includes("daily api limit exceeded") ||
				respStatus === 429
			) {
				const waitMs = calculateTimeUntilReset();
				const nextMidnight = new Date(Date.now() + waitMs);

				console.log(
					`⏰ Rate limited. Aguardando até ${nextMidnight.toLocaleString(
						"pt-BR"
					)} (~${Math.round(waitMs / 60000)} minutos)`
				);

				// Cancela timeout anterior se existir
				if (rateLimitWaitTimeout) {
					clearTimeout(rateLimitWaitTimeout);
				}

				// Aguarda até o reset e libera o lock
				rateLimitWaitTimeout = setTimeout(() => {
					console.log("🔄 Retomando verificações após reset do rate limit");
					isChecking = false;
					rateLimitWaitTimeout = null;
					// Força uma verificação imediata após o reset
					checkForNewMatches();
				}, waitMs);

				return; // Não libera isChecking aqui, será liberado pelo timeout
			}
			isChecking = false; // Libera para outros erros
			return;
		}

		if (!Array.isArray(matches) || matches.length === 0) {
			console.log("❌ Nenhuma partida encontrada");
			return;
		}

		const latestMatch = matches[0];
		const latestId = String(latestMatch.match_id);

		// Se é a primeira verificação, inicializa
		if (lastMatchId === null) {
			lastMatchId = latestId;
			state.lastMatchId = latestId;
			saveState(state);
			console.log(`✅ Inicializado com match ID: ${lastMatchId}`);
		}

		// Verifica se há nova partida
		if (latestId !== lastMatchId) {
			console.log(`🆕 Nova partida detectada: ${latestMatch.match_id}`);

			// Busca detalhes completos
			const matchDetails = await fetchMatchDetails(latestMatch.match_id);

			if (matchDetails.error) {
				console.error(
					"❌ Erro ao buscar detalhes da partida:",
					matchDetails.error
				);
				return;
			}

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
			const { embed, attachment } = await createMatchEmbed(
				matchDetails,
				playerData,
				heroes
			);
			const channel = await client.channels.fetch(CONFIG.CHANNEL_ID);
			await channel.send({
				embeds: [embed],
				files: attachment ? [attachment] : [],
			});

			// Atualiza e persiste última partida
			lastMatchId = latestId;
			state.lastMatchId = latestId;
			saveState(state);
			console.log("✅ Notificação enviada com sucesso!");
		} else {
			console.log("ℹ️ Nenhuma partida nova");
		}
	} catch (error) {
		console.error("❌ Erro ao verificar partidas:", error);
	} finally {
		// Só libera se não estamos aguardando rate limit reset
		if (!rateLimitWaitTimeout) {
			isChecking = false;
		}
	}
}

// Status check endpoint (avoiding conflict with OpenDota's /health)
const statusServer = http.createServer(async (req, res) => {
	if (req.url === "/status") {
		// Check OpenDota API health
		let opendotaHealth = { status: "unknown" };
		try {
			const healthRes = await fetch("https://api.opendota.com/api/health", {
				signal: AbortSignal.timeout(5000),
			});
			opendotaHealth = await healthRes.json();
		} catch (e) {
			opendotaHealth = { status: "error", error: e.message };
		}

		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify(
				{
					bot: {
						status: "ok",
						connected: client.isReady(),
						lastCheck: new Date().toISOString(),
						lastMatchId: lastMatchId,
						lastGameMode: state.lastGameMode,
						bestLowPriorityStreak: state.bestLowPriorityStreak,
						currentLowPriorityStreak: state.currentLowPriorityStreak,
						isChecking: isChecking,
						waitingForRateLimit: !!rateLimitWaitTimeout,
					},
					opendota: opendotaHealth,
				},
				null,
				2
			)
		);
	} else {
		res.writeHead(404);
		res.end("Not Found");
	}
});

statusServer.listen(CONFIG.HEALTH_CHECK_PORT, () => {
	console.log(
		`📊 Status check disponível em http://localhost:${CONFIG.HEALTH_CHECK_PORT}/status`
	);
});

// Eventos do Discord
client.once("ready", async () => {
	console.log(`✅ Bot conectado como ${client.user.tag}`);
	console.log(`👀 Monitorando jogador ID: ${CONFIG.PLAYER_ID}`);
	console.log(
		`⏱️ Intervalo de verificação: ${CONFIG.CHECK_INTERVAL / 60000} minutos`
	);
	console.log(
		`📊 Estado inicial: último game_mode: ${state.lastGameMode}, melhor streak: ${state.bestLowPriorityStreak}, streak atual: ${state.currentLowPriorityStreak}`
	);

	if (CONFIG.TEST_MATCH_ID) {
		console.log("🧪 Modo de teste com match específico - executando uma vez");
		checkForNewMatches();
		return;
	}

	// Testa acesso à API antes de iniciar verificações
	console.log("🔍 Testando acesso à API OpenDota...");
	const testResult = await fetchPlayerMatches();

	if (testResult.error) {
		console.error("❌ API inacessível no startup.");
		if (testResult.status === 429) {
			console.error(
				"⛔ Rate limit ativo. O bot aguardará automaticamente o reset."
			);
		} else {
			console.error(
				"⚠️ Continuando mesmo com erro. Tentativas futuras podem funcionar."
			);
		}
	} else {
		console.log("✅ API acessível!");
	}

	// Inicia verificação periódica
	checkForNewMatches(); // Primeira verificação imediata
	setInterval(checkForNewMatches, CONFIG.CHECK_INTERVAL);
});

client.on("error", (error) => {
	console.error("❌ Erro no cliente Discord:", error);
});

// Graceful shutdown
process.on("SIGINT", () => {
	console.log("\n🛑 Encerrando bot...");
	if (rateLimitWaitTimeout) {
		clearTimeout(rateLimitWaitTimeout);
	}
	statusServer.close();
	client.destroy();
	process.exit(0);
});

process.on("SIGTERM", () => {
	console.log("\n🛑 Encerrando bot...");
	if (rateLimitWaitTimeout) {
		clearTimeout(rateLimitWaitTimeout);
	}
	statusServer.close();
	client.destroy();
	process.exit(0);
});

// Inicia o bot
client.login(CONFIG.DISCORD_TOKEN);
