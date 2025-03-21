import fs from 'node:fs';
import path from 'node:path';
import { client as Client } from 'tmi.js';
const loadJSON = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url)));

import { logError, logWarning, logInfo, logData, sleep, contains, equals, randomInt } from "./utils.mjs";
import https from "https";

// Bot file
const commandProperties = ["name", "reply"];
const config = loadJSON('./config.json');
let autoMsgConfig = loadJSON('./automatedmessages.json');

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
    return client;
}

function reload() {
    registerCommands().catch(err => { logError(err); });
    if (autoMsgConfig.enabled === true) { reloadAutomatedMessages().catch(_ => {}); }
    loadFollowers().catch( err => { logError(err); });

    // Update channel live time and setup schedule to check every so often
    botStartTime = new Date().getTime();
    isTwitchChannelLive();
    setInterval(isTwitchChannelLive, 2 * 60 * 1000);
}

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
    options: { debug: false },
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
client.utils.isFollower = function (userId) {
    for (let i = 0; i < followerData.length; i++) {
        if (equals(followerData[i].id, userId)) { return i; }
    }
    return -1;
}
client.utils.getFollowerTime = function (index) {
    if (index < 0 || index > followerData.length - 1) { return -1; }
    return followerData[index].time;
}
client.utils.getTimeDifference = function (milliFrom, milliTo = new Date().getTime(), showMinutes = false) {
    const totalMinutes = Math.floor((milliTo - milliFrom) / 1000 / 60);
    const totalHours = Math.floor(totalMinutes / 60);
    const totalDays = Math.floor(totalHours / 24);
    const years = Math.floor(totalDays / 365);
    const days = totalDays - (years * 365);
    const hours = totalHours - (totalDays * 24);
    const minutes = totalMinutes - (totalHours * 60);
    return `${years > 0 ? `${years} years and ` : ``}${days > 0 ? `${days} days and ` : ``}${hours} hours${showMinutes ? (minutes > 0 ? ` and ${minutes} minutes` : ``) : ``}`;
}
client.utils.isAdminLevel = function (userState, role) { return getAdminLevel(getUserType(userState)) >= getAdminLevel(role); }
client.replies = {};
client.replies.BRC_NEEDED = "You do not have the correct permission for this command, you need to be at least a Broadcaster to use this";
client.replies.MOD_NEEDED = "You do not have the correct permission for this command, you need to be at least a Moderator to use this";
client.replies.SUB_NEEDED = "You do not have the correct permission for this command, you need to be at least a Subscriber to use this";
client.replies.PRI_NEEDED = "You do not have the correct permission for this command, you need to be at least a Prime Subscriber to use this";
client.replies.FOL_NEEDED = "You do not have the correct permission for this command, you need to be at least a Follower to use this";
client.roles = {};
client.roles.DEVELOPER   = DEVELOPER;
client.roles.BROADCASTER = BROADCASTER;
client.roles.MODERATOR   = MODERATOR;
client.roles.VIP         = VIP;
client.roles.SUBSCRIBER  = SUBSCRIBER;
client.roles.PRIME       = PRIME;
client.roles.VIEWER      = VIEWER;
client.global = {};

function setupEvents() {
    client.on('message', (channel, userState, message, self) => {
        logInfo(`[${channel}] ${userState['display-name']}: ${message}`);
        if (self) { return; }
        for (let i = 0; i < config.ignoreUsers.length; i++) { if (equals(config.ignoreUsers[i].toLowerCase(), userState['display-name'].toString().toLowerCase())) { return; } }
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
    client.on('ban', (channel, name, something, tags) => {
        sendMessageTwitch(channel, `${name} has been banned!`);
        logInfo(`${channel}: banned: ${name} info?: ${something} tags:`);
        logData(tags);
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
            logInfo(`Loaded command '${command.name}'`)
        }
    }
    logInfo("Loaded all possible commands");
}

async function parseTwitch(channel, userState, message) {
    const userName = userState['display-name'];
    const userId = userState['user-id'];
    if (message.startsWith(prefix)) {
        const params = message.trim().substring(prefix.length, message.length).split(" ");
        const commandName = params.shift().toLowerCase();
        // const adminLevel = getAdminLevel(getUserType(userState));

        let found = false;
        for (let i = 0; i < client.commands.length; i++) {
            if (equals(commandName, client.commands[i].name)) {
                const command = client.commands[i].command;

                command.reply(client, channel, userState, params, message);

                // end
                found = true;
                break;
            }
        }
        if (!found) {
            sendMessageTwitch(channel, `Couldn't find the command that you tried to use ${userName}...`)
        }
    } else {
        if (!contains(twitchChatters, userId)) {
            if (message.toString().indexOf("***") > -1) { return; }
            // if (hasURL(message)) { return; }
            twitchChatters.push(userId);
            const lines = ["Welcome {USER}!"]; // TODO: replace temporary message
            sendMessageTwitch(channel, lines[randomInt(lines.length)].replaceAll("{USER}", userName));
        }
        messagesSinceLastAutomatedMessage++;
    }
}

////////////////////////
// Automated messages //
////////////////////////

let runMessages = false; // gets changed by config
let messagesNeededBeforeAutomatedMessage = 10; // gets changed by config
let minutesBetweenAutomatedMessages = 5; // gets changed by config
let randomizedOrder = false; // gets changed by config
let automatedMessages = []; // gets changed by config
let messagesSinceLastAutomatedMessage = 0;
let automatedMessageManager;
let currentAutomatedMessage = 0;
let hasTimePassedSinceLastAutomatedMessage = true;

async function reloadAutomatedMessages() {
    autoMsgConfig = loadJSON('./automatedmessages.json');
    automatedMessages.slice(0, automatedMessages.length); // Make sure it starts empty
    for (let i = 0; i < autoMsgConfig.messages.length; i++) {
        const message = autoMsgConfig.messages[i]
        if (message.type === "burst") {
            if (!message.seconds) {
                logWarning("Message of type burst does not have a seconds variable, defaulting to 5 seconds!");
                message.seconds = 5;
            }
        }
        automatedMessages.push(message);
    }
    runMessages = false;
    await stopAutomatedMessagesManager();

    // Start new messages manager if there were any messages loaded
    if (automatedMessages.length > 0) { automatedMessageManager = automatedMessagesManager(); }
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
        if (randomizedOrder) { currentAutomatedMessage = randomInt(0, automatedMessages.length) }
        while (currentAutomatedMessage >= automatedMessages.length) { currentAutomatedMessage -= automatedMessages.length; }
        const message = automatedMessages[currentAutomatedMessage];

        switch (message.type.toLowerCase()) {
            case "single":
                if (message.messages.length > 0) { sendMessageTwitch(channel, message.messages[0]); }
                break;
            case "random":
                if (message.messages.length > 0) { sendMessageTwitch(channel, message.messages[randomInt(message.messages.length)]); }
                break;
            case "ordered":
                for (let i = 0; i < message.messages.length; i++) {
                    await awaitAutomatedMessageActive();
                    hasTimePassedSinceLastAutomatedMessage = false;
                    messagesSinceLastAutomatedMessage = 0;
                    sendMessageTwitch(channel, message.messages[i]);
                    if (i < message.messages.length - 1) { sleep(minutesBetweenAutomatedMessages * 60).then(_ => { hasTimePassedSinceLastAutomatedMessage = true; }); }
                }
                break;
            case "burst":
                for (let i = 0; i < message.messages.length; i++) {
                    sendMessageTwitch(channel, message.messages[i]);
                    if (i < message.messages.length - 1) { await sleep(message.seconds); }
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

///////////////
// Followers //
///////////////

const followerData = [];
const amountPerChunk = 100;
const secondsPerChunk = 3; // Used to throttle the cache loading of followers so it doesn't disturb the other twitch API usages
let chunk = 0;

async function loadFollowers(pagination = "") {
    if (pagination.length < 1) {
        logInfo("Started loading follower cache");
        console.time('followers');
    }
    const options = {
        hostname: 'api.twitch.tv',
        path: `/helix/channels/followers?broadcaster_id=${config.roomId}&first=${amountPerChunk}${pagination.length < 1 ? "" : `&after=${pagination}`}`,
        headers: {
            Authorization: `Bearer ${config.ttvtoken}`,
            'Client-ID': config.twitchId
        }
    }
    let parseData = "";
    https.get(options, r => {
        r.setEncoding('utf8');
        r.on('data', data => { parseData += data; });
        r.on('end', _ => {
            const json = JSON.parse(parseData);
            chunk++;
            logInfo(`Parsing chunk ${chunk}/${Math.max(1, Math.ceil(json.total / amountPerChunk))}`);
            const next = `${json.pagination.cursor}`.toString();
            if (next.length > 10) { sleep(secondsPerChunk).then(_ => loadFollowers(next)); } // Only start loading next batch if a new pagination for a batch has been given from the loaded data
            for (let i = 0; i < json.data.length; i++) {
                followerData.push({
                    id: json.data[i].user_id,
                    name: `${json.data[i].user_name}`,
                    time: parseTwitchTime(`${json.data[i].followed_at}`)
                });
            }
            if (chunk === Math.ceil(json.total / amountPerChunk)) {
                console.timeEnd('followers');
                logInfo("Finished loading follower cache");
            }
        });
    }).on('error', err => { logError(err); });
}

function parseTwitchTime(timeString) {
    const parts = timeString.split("T");
    const dateStr = parts[0].split("-");
    const timeStr = parts[1].replaceAll("Z", "").split(":");
    const date = new Date();
    date.setFullYear(parseInt(dateStr[0]), parseInt(dateStr[1]), parseInt(dateStr[2]));
    date.setHours(parseInt(timeStr[0]));
    date.setMinutes(parseInt(timeStr[1]));
    date.setSeconds(parseInt(timeStr[2]));
    return date.getTime();
}

///////////////
// Live info //
///////////////

let streamStartTime = 0;
let botStartTime = 0;
let attempts = 0;
const attemptsNeeded = 10;

async function isTwitchChannelLive() {
    const text = (await (await fetch(`https://twitch.tv/${config.channel}`).catch(err => { logError(err); return { text: async function() { return ""; }}})).text()).toString();
    if (text.length < 1) { return false; } // Return early if connection error occurs
    const liveIndex = text.indexOf("\",\"isLiveBroadcast\":true");
    if (liveIndex > 0) {
        const findStr = "\"startDate\":\"";
        streamStartTime = Date.parse(text.substring(text.indexOf(findStr) + findStr.length, liveIndex));
        return true;
    }
    if (twitchChatters.length > 0) {
        attempts++;
        if (attempts >= attemptsNeeded) {
            twitchChatters.splice(0, twitchChatters.length);
            attempts = 0;
        }
    }
    streamStartTime = botStartTime;
    return false;
}