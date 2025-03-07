import { concat } from "../utils.mjs";

export default {
    name: "help",
    async reply(client, channel, userState, params, message) {
        let commandList = [];
        for (let i = 0; i < client.commands.length; i++) { commandList.push(client.commands[i].name); }
        client.utils.sendChannelMessage(channel, `Possible commands: ${concat(commandList, ", ", "!").toLowerCase()}`)
    }
}