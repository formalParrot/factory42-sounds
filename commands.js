const { SlashCommandBuilder } = require("discord.js");

const commands = [
	new SlashCommandBuilder().setName("balance").setDescription("Show your sound balance"),
	new SlashCommandBuilder()
		.setName("buy")
		.setDescription("Buy a sound with your voice-channel earnings")
		.addStringOption((option) =>
			option
				.setName("sound")
				.setDescription("The sound to buy")
				.setRequired(true)
				.setAutocomplete(true),
		),
].map((command) => command.toJSON());

module.exports = commands;