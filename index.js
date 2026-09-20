require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, Events } = require("discord.js");
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

const JOIN_DELAY_MS = 1000;

// ---- Sounds: drop join.(mp3|wav|ogg) and leave.(mp3|wav|ogg) in ./sounds ----
function findSound(name) {
	for (const ext of ["mp3", "wav", "ogg"]) {
		const p = path.join(__dirname, "sounds", `${name}.${ext}`);
		if (fs.existsSync(p)) return p;
	}
	throw new Error(`No sounds/${name}.(mp3|wav|ogg) found`);
}
const SOUNDS = { join: findSound("join"), leave: findSound("leave") };

// ---- Client & player ----
const client = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

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

	if (!wasIn && isIn) setTimeout(() => enqueue(SOUNDS.join), JOIN_DELAY_MS);
	else if (wasIn && !isIn) enqueue(SOUNDS.leave);
	// mute/deafen/stream changes keep the same channel, so they're ignored
});

client.once(Events.ClientReady, () => {
	console.log(`Logged in as ${client.user.tag}`);
	connect().catch(console.error);
	// Watchdog: make sure we're always in the channel
	setInterval(() => connect().catch(console.error), 30_000);
});

process.on("unhandledRejection", (err) =>
	console.error("Unhandled rejection:", err),
);
client.login(DISCORD_TOKEN);
