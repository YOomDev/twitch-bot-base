import { concat } from "../utils.mjs";

export default {
    name: "help",
    async reply(client, channel, userState, params, message) {
        const commandList = concat(client.commands, ", ");
        client.utils.sendChannelMessage(channel, `Possible commands: ${commandList.toLowerCase()}`)
    }
}