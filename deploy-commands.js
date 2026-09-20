require("dotenv").config();
const { REST, Routes } = require("discord.js");
const commands = require("./commands");

const { DISCORD_TOKEN, GUILD_ID, APPLICATION_ID } = process.env;
if (!DISCORD_TOKEN || !GUILD_ID) {
	console.error("Missing DISCORD_TOKEN or GUILD_ID in .env");
	process.exit(1);
}

const applicationId = APPLICATION_ID || DISCORD_TOKEN.split(".")[0];

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