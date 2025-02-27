import fs from 'node:fs';
import path from 'node:path';
import { client as Client } from 'tmi.js';
const loadJSON = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url)));

import { logError, logWarning, logInfo, sleep, contains, equals, randomInt, concat, readFile, logData } from "./utils.mjs";

// Bot file
const commandProperties = ["name", "reply"];
const config = loadJSON('./config.json');
const autoMsgConfig = loadJSON('./automatedmessages.json');

const twitchChatters = [];

let ready = false;
const prefix = "!";

export async function start(cmdProperties = []) {
    for (const properties of cmdProperties) { if (!contains(commandProperties, properties)) { commandProperties.push(properties); } }
    ready = false;
    client.connect().catch(err => { logError(err); }).then(_ => { ready = true; });
    setupEvents();
    while (!ready) { await sleep(0.25); }
    ready = false;
    reload();
    if (autoMsgConfig.enabled === true) { reloadAutomatedMessages().catch(_ => {}); }
    return client;
}

function reload() { registerCommands(); }

////////////////
// Twitch Bot //
////////////////

// Roles
const DEVELOPER   = "Dev"
const BROADCASTER = "Broadcaster";
const MODERATOR   = "Moderator";
const VIP         = "VIP";
const SUBSCRIBER  = "Subscriber";
const PRIME       = "Prime sub";
const VIEWER      = "Viewer";

const adminLevels = [
    VIEWER,
    PRIME,
    SUBSCRIBER,
    VIP,
    MODERATOR,
    BROADCASTER,
    DEVELOPER
];

function getUserType(userState) {
    if (equals(userState.username, config.superuserName)) { return DEVELOPER; }
    if (userState.badges) { if (userState.badges['broadcaster']) { return BROADCASTER; } }
    if (userState.mod) { return MODERATOR  ; }
    if (userState.badges) { if (userState.badges['vip']) { return VIP; } }
    if (userState.subscriber) { return SUBSCRIBER ; }
    if (userState.badges) { if (userState.badges['premium']) { return PRIME; } }
    logWarning("No role determined from:");
    logData(userState.badges);
    return VIEWER;
}

function getAdminLevel(type) {
    for (let i = 0; i < adminLevels.length; ++i) { if (type === adminLevels[i]) { return i; } }
    logWarning(`No admin level found for type: ${type}`);
    return -1;
}

const client = new Client({
    options: { debug: true },
    connection: { reconnect: true, secure: true },
    identity: {
        username: config.clientName,
        password: `oauth:${config.ttvtoken}`
    },
    channels: [`#${config.channel}`]
});
client.commands = [];
client.utils = {};
client.utils.sendChannelMessage = sendMessageTwitch;
client.utils.log = logInfo;
client.utils.logWarn = logWarning;
client.utils.logErr = logError;
client.utils.data = logData;
client.global = {};

function setupEvents() {
    client.on('message', (channel, userState, message, self) => {
        if (self) { return; }
        // line below will be replaced by if statement above this when it works
        for (let i = 0; i < ignoreUsers.length; i++) { if (equals(ignoreUsers[i].toLowerCase(), userState['display-name'].toString().toLowerCase())) { return; } }
        parseTwitch(channel, userState, message).catch(err => logError(err));
    });
    client.on('clearchat', (channel, self) => {
        if (self) { return; }
        sendMessageTwitch(channel, `Cleared the chat - Happy chatting!`);
        logInfo(`${channel}: Moderator cleared the chat.`);
    });
    client.on('unhost', (channel, viewers) => {
        sendMessageTwitch(channel, `Stopped hosting ${channel} with ${viewers} viewers`);
        logInfo(`${channel}: Stopped hosting on ${channel} with ${viewers}`);
    });
    client.on('hosting', (channel, msgSplit, viewers) => {
        sendMessageTwitch(channel, `Hosting ${channel} together with ${viewers}`);
        logInfo(`${channel}: Hosting on ${channel} with ${viewers}`);
    });
    client.on('raided', (channel, username, viewers, tags) => {
        sendMessageTwitch(channel, `${tags['system-msg']}`);
        logInfo(`${channel}: ${tags['system-msg']}`);
    });
    client.on('ban', (channel, msg, something, tags) => {
        sendMessageTwitch(channel, `Ban on ${channel} for username ${msg}`);
        logInfo(`${channel}: banned: ${msg}`);
    });
    client.on('timeout', (channel, msg, something, duration, tags) => {
        sendMessageTwitch(channel, `Timeout for username ${msg} with a duration of ${duration}`);
        logInfo(`${channel}: timeout: ${msg}:${duration}`);
    });
    client.on('resub', (channel, username, methods, msg, tags) => {
        if (msg) {
            sendMessageTwitch(channel, `${tags['system-msg']} Message: ${msg}`);
            logInfo(`${channel}: ${tags['system-msg']} Message: ${msg}`);
        } else {
            sendMessageTwitch(channel, `${tags['system-msg']}`);
            logInfo(`${channel}: ${tags['system-msg']}`);
        }
    });
    client.on('sub', (channel, username, methods, msg, tags) => {
        if (msg) {
            sendMessageTwitch(channel, `${tags['system-msg']} Message: ${msg}`);
            logInfo(`${channel}: ${tags['system-msg']} Message: ${msg}`);
        } else {
            sendMessageTwitch(channel, `${tags['system-msg']}`);
            logInfo(`${channel}: ${tags['system-msg']}`);
        }
    });
    client.on('subgift', (channel, username, streakMonths, recipient, methods, tags) => {
        sendMessageTwitch(channel, `${tags['system-msg']}`);
        logInfo(`${channel}: ${tags['system-msg']}`);
    });
    client.on('anonsubgift', (channel, streakMonths, recipient, methods, tags) => {
        sendMessageTwitch(channel, `${tags['system-msg']}`);
        logInfo(`${channel}: ${tags['system-msg']}`);
    });
    client.on('submysterygift', (channel, username, giftSubCount, methods, tags) => {
        sendMessageTwitch(channel, `${tags['system-msg']}`);
        logInfo(`${channel}: ${tags['system-msg']}`);
    });
    client.on('anonsubmysterygift', (channel, giftSubCount, methods, tags) => {
        sendMessageTwitch(channel, `${tags['system-msg']}`);
        logInfo(`${channel}: ${tags['system-msg']}`);
    });
    client.on('primepaidupgrade', (channel, username, methods, tags) => {
        sendMessageTwitch(channel, `${tags['system-msg']}`);
        logInfo(`${channel}: ${tags['system-msg']}`);
    });
    client.on('giftpaidupgrade', (channel, username, sender, tags) => {
        sendMessageTwitch(channel, `${tags['system-msg']}`);
        logInfo(`${channel}: ${tags['system-msg']}`);
    });
    client.on('anongiftpaidupgrade', (channel, username, tags) => {
        sendMessageTwitch(channel, `${tags['system-msg']}`);
        logInfo(`${channel}: ${tags['system-msg']}`);
    });
}

// TODO: add message queueing for large userbases to make sure api limits are not exceeded
function sendMessageTwitch(channel, msg) { if (msg && channel) { client.say(channel, msg); } else { logError("Tried sending a message but either the message or the channel was missing from the specified arguments!"); } }

async function registerCommands() {
    logInfo("Started loading commands.");
    client.commands.slice(0, client.commands.length);

    const folders = ["./commands", "./twitch-bot-base/commands"];
    // for (const folder of commandFolders) { folders.push(folder); }
    for (const folder of folders) {
        const commandFiles = fs.readdirSync(folder).filter(file => file.endsWith('.mjs'));
        for (const file of commandFiles) {
            const filePath = "..\\" + path.join(folder, file);
            let command = (await import(new URL(filePath, import.meta.url)).catch(err => logError(err)).then(_ => { return _; })).default;

            // Check if command has all the needed properties
            let failed = false;
            for (let i = 0; i < commandProperties.length; i++) {
                if (!(commandProperties[i] in command)) {
                    logWarning(`${filePath} is missing "${commandProperties[i]}" property.`);
                    failed = true;
                }
            }
            if (failed) { continue; } // Skip

            // Set a new item in the Collection with the key as the command name and the value as the exported module
            client.commands.push({ name: command.name, command: command });
        }
    }
    logInfo("Loaded all possible commands");
}

async function parseTwitch(channel, userState, message) {
    const userId = userState['user-id'];
    if (message.startsWith(prefix)) {
        const params = message.trim().substring(prefix.length, message.length).split(" ");
        const commandName = params.shift().toLowerCase();
        // const adminLevel = getAdminLevel(getUserType(userState));

        let found = false;
        for (let i = 0; i < client.commands.length; i++) {
            if (equals(commandName, client.commands[i].name)) {
                const command = client.commands[i];

                command.reply(client, channel, userState, params, message);

                // end
                found = true;
                break;
            }
        }
        if (!found) {
            sendMessageTwitch(channel, `Couldn't find the command that you tried to use ${userState['display-name']}...`)
        }
    } else {
        if (!contains(twitchChatters, userId)) {
            if (message.toString().indexOf("***") > -1) { return; }
            // if (hasURL(message)) { return; }
            twitchChatters.push(userId);
            const lines = readFile(`${config.automatedMessagesFolder}welcomeMessages${userState['first-msg'] ? "First" : ""}.txt`);
            sendMessageTwitch(channel, lines[randomInt(lines.length)].replaceAll("{USER}", userState['display-name']));
        }
        messagesSinceLastAutomatedMessage++;
    }
}

////////////////////////
// Automated messages // // TODO: REFACTOR or REWRITE!
////////////////////////

async function reloadAutomatedMessages() {
    const messageConfig = readFile(`${config.automatedMessagesFolder}config.txt`);
    for (let i = 0; i < messageConfig.length; i++) {
        let line = messageConfig[i].split(" ");
        switch (line[0]) {
            case "message":
            case "sequence":
            case "list":
                if (line.length > 1) {
                    automatedMessages.push({ type: line[0], file: concat(line, " ", "", 1) });
                    break;
                }
                logError(`Couldn\'t interpret automated message from config line ${i}: ${line}`);
                break;
            default:
                logError(`Couldn\'t interpret automated message from config line ${i}: ${line}`);
                break;
        }
    }
    runMessages = false;
    await stopAutomatedMessagesManager();
    automatedMessageManager = automatedMessagesManager(); // Start new messages manager
}

async function stopAutomatedMessagesManager() {
    runMessages = false;
    if (automatedMessageManager) { await automatedMessageManager; }
    automatedMessageManager = 0;
    currentAutomatedMessage = 0;
}

function isChatActive() {
    if (messagesSinceLastAutomatedMessage < messagesNeededBeforeAutomatedMessage) { return false; }
    return hasTimePassedSinceLastAutomatedMessage;
}

async function awaitAutomatedMessageActive() { while (!isChatActive() && runMessages) { await sleep(1); } }

async function automatedMessagesManager() {
    runMessages = true;
    while (runMessages) {
        await awaitAutomatedMessageActive();
        await playAutomatedMessage();
    }
}

async function playAutomatedMessage() {
    if (!runMessages) { return; }
    if (isChatActive()) {
        const channel = client.channels[0];
        while (currentAutomatedMessage >= automatedMessages.length) { currentAutomatedMessage -= automatedMessages.length; }
        const message = automatedMessages[currentAutomatedMessage];
        let lines = readFile(`${config.automatedMessagesFolder}${message.file}.txt`);
        switch (message.type) {
            case "message":
                sendMessageTwitch(channel, lines[randomInt(lines.length)]);
                break;
            case "sequence":
                for (let i = 0; i < lines.length; i++) {
                    await awaitAutomatedMessageActive();
                    hasTimePassedSinceLastAutomatedMessage = false;
                    messagesSinceLastAutomatedMessage = 0;
                    sendMessageTwitch(channel, lines[i]);
                    if (i < lines.length - 1) { sleep(minutesBetweenAutomatedMessages * 60).then(_ => { hasTimePassedSinceLastAutomatedMessage = true; }); }
                }
                break;
            case "list":
                for (let i = 0; i < lines.length; i++) {
                    sendMessageTwitch(channel, lines[i]);
                    if (i < lines.length - 1) {await sleep(5); }
                }
                break;
            default:
                logError(`Message type (${message.type}) not implemented. `);
                break;
        }
        currentAutomatedMessage++;
        hasTimePassedSinceLastAutomatedMessage = false;
        messagesSinceLastAutomatedMessage = 0;
        sleep(minutesBetweenAutomatedMessages * 60).then(_ => { hasTimePassedSinceLastAutomatedMessage = true; });
    }
}