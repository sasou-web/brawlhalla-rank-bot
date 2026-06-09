import { REST, Routes } from "discord.js";
import { config } from "./config.js";
import { commandsData } from "./commands.js";

const rest = new REST({ version: "10" }).setToken(config.token);

try {
  console.log(`Enregistrement de ${commandsData.length} slash command(s) sur la guild ${config.guildId}...`);
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
    body: commandsData,
  });
  console.log("Slash commands enregistrees avec succes.");
} catch (err) {
  console.error("Echec de l'enregistrement des commandes :", err);
  process.exit(1);
}
