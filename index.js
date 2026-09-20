require("dotenv").config();
const fs = require("fs");
const path = require("path");
const {
	Client,
	GatewayIntentBits,
	Events,
	REST,
	Routes,
} = require("discord.js");
const commands = require("./commands");
const {
	joinVoiceChannel,
	getVoiceConnection,
	createAudioPlayer,
	createAudioResource,
	entersState,
	AudioPlayerStatus,
	VoiceConnectionStatus,
	NoSubscriberBehavior,
} = require("@discordjs/voice");

const { DISCORD_TOKEN, GUILD_ID, VOICE_CHANNEL_ID } = process.env;
if (!DISCORD_TOKEN || !GUILD_ID || !VOICE_CHANNEL_ID) {
	console.error("Missing DISCORD_TOKEN, GUILD_ID or VOICE_CHANNEL_ID in .env");
	process.exit(1);
}

const JOIN_DELAY_MS = 1500;
const EURO_PER_MINUTE = 1;
const ECONOMY_FILE = path.join(__dirname, "economy.json");
const ECONOMY_ROLE_NAME = "Convenience Store Worker";

// ---- Sounds: join.mp3 and leave.mp3 are the default sounds ----
function findSound(name) {
	for (const ext of ["mp3", "wav", "ogg"]) {
		const soundPath = path.join(__dirname, "sounds", `${name}.${ext}`);
		if (fs.existsSync(soundPath)) return soundPath;
	}
	throw new Error(`No sounds/${name}.(mp3|wav|ogg) found`);
}

const SOUNDS = {
	join: path.join(__dirname, "sounds", "join.mp3"),
	leave: path.join(__dirname, "sounds", "leave.mp3"),
};
if (!fs.existsSync(SOUNDS.join) || !fs.existsSync(SOUNDS.leave)) {
	throw new Error("sounds/join.mp3 and sounds/leave.mp3 are required");
}

function getShopSounds() {
	return fs
		.readdirSync(path.join(__dirname, "sounds"), { withFileTypes: true })
		.filter(
			(entry) =>
				entry.isFile() &&
				["mp3", "wav", "ogg"].includes(
					path.extname(entry.name).slice(1).toLowerCase(),
				),
		)
		.map((entry) => path.basename(entry.name, path.extname(entry.name)))
		.filter((name) => name.startsWith("c-"))
		.filter((name) => !["c-join", "c-leave"].includes(name))
		.filter((name, index, names) => names.indexOf(name) === index)
		.sort();
}

const SHOP_SOUNDS = getShopSounds();
const SOUND_PRICES = {
	// Add sound names here when they should cost something other than €1.
	// Example: "airhorn": 5,
};
const DEFAULT_SOUND_PRICE = 1;

function getSoundPrice(sound) {
	return (
		SOUND_PRICES[sound] ?? SOUND_PRICES[sound.slice(2)] ?? DEFAULT_SOUND_PRICE
	);
}

function getSoundName(sound) {
	return sound.slice(2);
}

function getSoundFile(sound) {
	return findSound(sound);
}

function getSoundId(displayName) {
	return `c-${displayName}`;
}

function loadEconomy() {
	try {
		return JSON.parse(fs.readFileSync(ECONOMY_FILE, "utf8"));
	} catch (err) {
		if (err.code !== "ENOENT")
			console.error("Failed to read economy.json:", err.message);
		return { users: {} };
	}
}

let economy = loadEconomy();
if (!economy.users || typeof economy.users !== "object")
	economy = { users: {} };

function saveEconomy() {
	const temporaryFile = `${ECONOMY_FILE}.tmp`;
	fs.writeFileSync(temporaryFile, `${JSON.stringify(economy, null, 2)}\n`);
	fs.renameSync(temporaryFile, ECONOMY_FILE);
}

function getUserAccount(userId) {
	if (!economy.users[userId])
		economy.users[userId] = { balance: 0, sounds: [], equipped: null };
	if (!Array.isArray(economy.users[userId].sounds))
		economy.users[userId].sounds = [];
	if (!Object.hasOwn(economy.users[userId], "equipped"))
		economy.users[userId].equipped = null;
	return economy.users[userId];
}

function settleUser(userId, now = Date.now()) {
	const startedAt = activeVoiceSessions.get(userId);
	if (!startedAt) return 0;

	const earnedMinutes = Math.floor((now - startedAt) / 60_000);
	if (earnedMinutes < 1) return 0;

	const account = getUserAccount(userId);
	account.balance += earnedMinutes * EURO_PER_MINUTE;
	activeVoiceSessions.set(userId, startedAt + earnedMinutes * 60_000);
	return earnedMinutes * EURO_PER_MINUTE;
}

function settleAllActiveUsers() {
	let changed = false;
	for (const userId of activeVoiceSessions.keys())
		changed = settleUser(userId) > 0 || changed;
	if (changed) saveEconomy();
}

async function registerCommands() {
	const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
	const registeredCommands = await rest.put(
		Routes.applicationGuildCommands(client.user.id, GUILD_ID),
		{
			body: commands,
		},
	);

	const role = client.guilds.cache
		.get(GUILD_ID)
		?.roles.cache.find((guildRole) => guildRole.name === ECONOMY_ROLE_NAME);
	const restrictedCommands = registeredCommands.filter((command) =>
		["give", "take"].includes(command.name),
	);
	if (!role) {
		console.error(
			`Role "${ECONOMY_ROLE_NAME}" was not found; /give and /take remain hidden.`,
		);
		return;
	}

	for (const command of restrictedCommands) {
		await rest.put(
			Routes.applicationCommandPermissions(
				client.user.id,
				GUILD_ID,
				command.id,
			),
			{
				body: {
					permissions: [{ id: role.id, type: 1, permission: true }],
				},
			},
		);
	}
	console.log(
		"Registered commands; /give and /take are restricted to the craete events role.",
	);
}

// ---- Client & player ----
const client = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const activeVoiceSessions = new Map();

const player = createAudioPlayer({
	behaviors: { noSubscriber: NoSubscriberBehavior.Play },
});

const queue = [];
const MAX_QUEUE = 10;

function playNext() {
	const file = queue.shift();
	if (file) player.play(createAudioResource(file));
}

function enqueue(file) {
	if (queue.length >= MAX_QUEUE) return;
	queue.push(file);
	if (player.state.status === AudioPlayerStatus.Idle) playNext();
}

player.on(AudioPlayerStatus.Idle, playNext);
player.on("error", (err) => {
	console.error("Player error:", err.message);
	playNext();
});

// ---- 24/7 voice connection ----
async function connect() {
	const existing = getVoiceConnection(GUILD_ID);
	if (existing && existing.state.status !== VoiceConnectionStatus.Destroyed)
		return;

	const guild = client.guilds.cache.get(GUILD_ID);
	if (!guild) return;

	const connection = joinVoiceChannel({
		channelId: VOICE_CHANNEL_ID,
		guildId: GUILD_ID,
		adapterCreator: guild.voiceAdapterCreator,
		selfDeaf: true,
	});

	connection.on(VoiceConnectionStatus.Disconnected, async () => {
		try {
			// If Discord is just moving us / resuming, this succeeds and we're fine
			await Promise.race([
				entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
				entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
			]);
		} catch {
			// Truly disconnected (kicked, network drop, etc.) -> tear down and rejoin
			if (connection.state.status !== VoiceConnectionStatus.Destroyed)
				connection.destroy();
			setTimeout(() => connect().catch(console.error), 5_000);
		}
	});

	try {
		await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
		connection.subscribe(player);
		console.log("Connected to voice channel.");
	} catch (err) {
		console.error("Failed to connect, retrying in 10s:", err.message);
		if (connection.state.status !== VoiceConnectionStatus.Destroyed)
			connection.destroy();
		setTimeout(() => connect().catch(console.error), 10_000);
	}
}

// ---- Join / leave detection ----
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
	if (newState.guild.id !== GUILD_ID) return;
	if (newState.member?.user.bot) return; // ignore bots (incl. ourselves)

	const wasIn = oldState.channelId === VOICE_CHANNEL_ID;
	const isIn = newState.channelId === VOICE_CHANNEL_ID;

	if (!wasIn && isIn) {
		activeVoiceSessions.set(newState.id, Date.now());
		setTimeout(() => {
			const account = getUserAccount(newState.id);
			enqueue(account.equipped ? getSoundFile(account.equipped) : SOUNDS.join);
		}, JOIN_DELAY_MS);
	} else if (wasIn && !isIn) {
		settleUser(oldState.id);
		activeVoiceSessions.delete(oldState.id);
		saveEconomy();
		enqueue(SOUNDS.leave);
	}
	// mute/deafen/stream changes keep the same channel, so they're ignored
});

client.on(Events.InteractionCreate, async (interaction) => {
	if (interaction.isAutocomplete()) {
		if (!["buy", "equip"].includes(interaction.commandName)) return;
		const account = getUserAccount(interaction.user.id);
		const query = interaction.options.getString("sound", true).toLowerCase();
		const choices = SHOP_SOUNDS.filter((sound) => {
			const isBuy = interaction.commandName === "buy";
			const available = isBuy
				? !account.sounds.includes(sound)
				: account.sounds.includes(sound);
			return available && getSoundName(sound).toLowerCase().includes(query);
		}).slice(0, 25);
		await interaction.respond(
			choices.map((sound) => ({
				name:
					interaction.commandName === "buy"
						? `${getSoundName(sound)} - €${getSoundPrice(sound)}`
						: getSoundName(sound),
				value: getSoundName(sound),
			})),
		);
		return;
	}

	if (!interaction.isChatInputCommand()) return;

	if (["give", "take"].includes(interaction.commandName)) {
		const hasEconomyRole = interaction.member?.roles.cache.some(
			(role) => role.name === ECONOMY_ROLE_NAME,
		);
		if (!hasEconomyRole) {
			await interaction.reply({
				content: "You do not have permission to use this command.",
				ephemeral: true,
			});
			return;
		}
	}

	if (interaction.commandName === "balance") {
		settleUser(interaction.user.id);
		const account = getUserAccount(interaction.user.id);
		saveEconomy();
		await interaction.reply(
			`Balance: €${account.balance}\nOwned sounds: ${account.sounds.length ? account.sounds.map(getSoundName).join(", ") : "none"}`,
		);
		return;
	}

	if (interaction.commandName === "buy") {
		settleUser(interaction.user.id);
		const account = getUserAccount(interaction.user.id);
		const sound = getSoundId(interaction.options.getString("sound", true));

		if (!SHOP_SOUNDS.includes(sound)) {
			await interaction.reply({
				content: "That sound is not available.",
				ephemeral: true,
			});
			return;
		}
		if (account.sounds.includes(sound)) {
			await interaction.reply({
				content: "You already own that sound.",
				ephemeral: true,
			});
			return;
		}
		const price = getSoundPrice(sound);
		if (account.balance < price) {
			await interaction.reply({
				content: `You need €${price} to buy that sound.`,
				ephemeral: true,
			});
			return;
		}

		account.balance -= price;
		account.sounds.push(sound);
		saveEconomy();
		await interaction.reply(
			`Bought **${getSoundName(sound)}** for €${price}. Your balance is €${account.balance}.`,
		);
		return;
	}

	if (interaction.commandName === "equip") {
		const account = getUserAccount(interaction.user.id);
		const sound = getSoundId(interaction.options.getString("sound", true));

		if (!SHOP_SOUNDS.includes(sound) || !account.sounds.includes(sound)) {
			await interaction.reply({
				content: "You do not own that sound.",
				ephemeral: true,
			});
			return;
		}

		account.equipped = sound;
		saveEconomy();
		await interaction.reply(
			`Equipped **${getSoundName(sound)}** for when you join.`,
		);
		return;
	}

	if (["give", "take"].includes(interaction.commandName)) {
		const target = interaction.options.getMember("member");
		const amount = interaction.options.getInteger("euro", true);
		if (!target) {
			await interaction.reply({
				content: "That member is not in this server.",
				ephemeral: true,
			});
			return;
		}

		const account = getUserAccount(target.id);
		settleUser(target.id);
		if (interaction.commandName === "take" && account.balance < amount) {
			await interaction.reply({
				content: `${target.displayName} only has €${account.balance}.`,
				ephemeral: true,
			});
			return;
		}

		account.balance += interaction.commandName === "give" ? amount : -amount;
		saveEconomy();
		const action = interaction.commandName === "give" ? "Gave" : "Took";
		await interaction.reply(
			`${action} €${amount} ${interaction.commandName === "give" ? "to" : "from"} ${target}. Their balance is €${account.balance}.`,
		);
	}
});

client.once(Events.ClientReady, () => {
	console.log(`Logged in as ${client.user.tag}`);
	const guild = client.guilds.cache.get(GUILD_ID);
	const voiceChannel = guild?.channels.cache.get(VOICE_CHANNEL_ID);
	for (const member of voiceChannel?.members.values() ?? []) {
		if (!member.user.bot) activeVoiceSessions.set(member.id, Date.now());
	}
	registerCommands().catch((err) =>
		console.error("Failed to register commands:", err.message),
	);
	connect().catch(console.error);
	// Watchdog: make sure we're always in the channel
	setInterval(() => connect().catch(console.error), 30_000);
	setInterval(settleAllActiveUsers, 60_000);
});

process.on("unhandledRejection", (err) =>
	console.error("Unhandled rejection:", err),
);
client.login(DISCORD_TOKEN);
