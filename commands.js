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
	new SlashCommandBuilder()
		.setName("equip")
		.setDescription("Equip one of your sounds for when you join")
		.addStringOption((option) =>
			option
				.setName("sound")
				.setDescription("The sound to equip")
				.setRequired(true)
				.setAutocomplete(true),
		),
	new SlashCommandBuilder()
		.setName("give")
		.setDescription("Give euros to a member")
		.setDefaultMemberPermissions("0")
		.addUserOption((option) =>
			option.setName("member").setDescription("The member to give euros to").setRequired(true),
		)
		.addIntegerOption((option) =>
			option
				.setName("euro")
				.setDescription("The number of euros to give")
				.setMinValue(1)
				.setRequired(true),
		),
	new SlashCommandBuilder()
		.setName("take")
		.setDescription("Take euros from a member")
		.setDefaultMemberPermissions("0")
		.addUserOption((option) =>
			option.setName("member").setDescription("The member to take euros from").setRequired(true),
		)
		.addIntegerOption((option) =>
			option
				.setName("euro")
				.setDescription("The number of euros to take")
				.setMinValue(1)
				.setRequired(true),
		),
].map((command) => command.toJSON());

module.exports = commands;