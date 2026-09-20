require("dotenv").config();
const { REST, Routes } = require("discord.js");
const commands = require("./commands");

const { DISCORD_TOKEN, GUILD_ID, APPLICATION_ID } = process.env;
if (!DISCORD_TOKEN || !GUILD_ID) {
	console.error("Missing DISCORD_TOKEN or GUILD_ID in .env");
	process.exit(1);
}

function tokenToApplicationId(token) {
	const idSegment = token.split(".")[0];
	const padded = idSegment.replace(/-/g, "+").replace(/_/g, "/");
	const decoded = Buffer.from(
		padded + "=".repeat((4 - (padded.length % 4)) % 4),
		"base64",
	).toString("utf8");
	return /^\d+$/.test(decoded) ? decoded : idSegment;
}

const applicationId = APPLICATION_ID || tokenToApplicationId(DISCORD_TOKEN);

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

(async () => {
	try {
		await rest.put(Routes.applicationGuildCommands(applicationId, GUILD_ID), {
			body: commands,
		});
		console.log(`Registered ${commands.length} guild commands in ${GUILD_ID}.`);
	} catch (err) {
		console.error("Failed to register commands:", err);
		process.exit(1);
	}
})();