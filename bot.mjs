import fs from 'node:fs';
import path from 'node:path';
import { client as Client } from 'tmi.js';
const loadJSON = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url)));

import { logError, logWarning, logInfo, logData, sleep, contains, equals, randomInt, concat } from "./utils.mjs";
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
    setInterval(loadFollowers, 4 * 60* 60 * 1000); // TODO: temporary 4h interval follower reload until the replacement using (hopefully local) webhooks is added

    // Update channel live time and setup schedule to check every so often
    client.utils.startTime = new Date().getTime();
    isTwitchChannelLive();
    setInterval(isTwitchChannelLive, 15 * 60 * 1000);
}

////////////////
// Twitch Bot //
////////////////

function getUserType(userState) {
    if (equals(userState.username, config.superuserName))         { return client.roles.DEVELOPER  ; }
    if (userState.badges     && userState.badges['broadcaster'] ) { return client.roles.BROADCASTER; }
    if (userState.mod                                           ) { return client.roles.MODERATOR  ; }
    if (userState.badges     && userState.badges['vip']         ) { return client.roles.VIP        ; }
    if (userState.subscriber                                    ) { return client.roles.SUBSCRIBER ; }
    if (userState.badges     && userState.badges['premium']     ) { return client.roles.PRIME      ; }
    logWarning("No role determined from:");
    logData(userState.badges);
    return client.roles.VIEWER;
}

function getAdminLevel(type) {
    const index = client.adminLevels.indexOf(type);
    if (index < 1) { logWarning(`No admin level found for type: ${type}`); }
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
client.utils = {
    log:     logInfo,
    logWarn: logWarning,
    logErr:  logError,
    data:    logData,
    sendChannelMessage: sendMessageTwitch,
};
client.utils.streamStartTime = 0;
client.utils.startTime = 0;
client.utils.isFollower = function (userId, type = "") {
    switch (type.toLowerCase()) {
        case 'name':
            for (let i = 0; i < followerData.length; i++) {
                if (equals(followerData[i].name.toLowerCase(), userId.toLowerCase())) { return i; }
            }
            break;
        default:
            for (let i = 0; i < followerData.length; i++) {
                if (equals(followerData[i].id, userId)) { return i; }
            }
            break;
    }
    return -1;
}
client.utils.getFollowerTime = function (index) {
    if (index < 0 || index > followerData.length - 1) { return -1; }
    return followerData[index].time;
}
client.utils.getFollowerCount = function () { return followerData.length; }
client.utils.getFollowerName = function (index) {
    if (index < 0 || index > followerData.length - 1) { return ""; }
    return followerData[index].name;
}
const userDataCache = [];
client.utils.getAccountAge = async function (username) {
    // See if user is already cached
    for (let i = 0; i < userDataCache.length; i++) { if (equals(userDataCache[i].display_name.toLowerCase(), username.toLowerCase())) { return new Date(userDataCache[i].created_at).getTime(); } }

    // If not cached, fetch from api and store in cache
    const url = `https://api.twitch.tv/helix/users?login=${username}`;
    const options = {
        method: 'GET',
        headers: {
            'Client-ID': config.twitchId,
            'Authorization': `Bearer ${config.ttvtoken}`
        }
    };
    const response = await fetch(url, options);
    if (!response.ok) {
        logWarning(`Could not fetch account info! http response: ${response.status}`);
        logData(response);
        return -1;
    }
    const data = await response.json();
    if (!data.data || data.data.length < 1) { logWarning('Error parsing json from account age'); return -1; }
    userDataCache.push(data.data[0]);
    return new Date(data.data[0].created_at).getTime();
}
client.utils.isAdminLevel = function (userState, role) {
    return getAdminLevel(getUserType(userState)) >= getAdminLevel(role);
}
client.replies = {
    BRC_NEEDED: "You do not have the correct permission for this command, you need to be at least a Broadcaster to use this",
    MOD_NEEDED: "You do not have the correct permission for this command, you need to be at least a Moderator to use this",
    SUB_NEEDED: "You do not have the correct permission for this command, you need to be at least a Subscriber to use this",
    PRI_NEEDED: "You do not have the correct permission for this command, you need to be at least a Prime Subscriber to use this",
    FOL_NEEDED: "You do not have the correct permission for this command, you need to be at least a Follower to use this",
    ARG_NEEDED: "Not enough arguments given.",
    INVALID_NUMBER: "An invalid number has been given as an argument.",
    INVALID_ARGUMENT: "An invalid argument has been given.",
    INVALID_SUBCOMMAND: "An invalid subcommand has been given.",
};
client.roles = {
    VIEWER:      'Viewer',
    PRIME:       'Prime',
    SUBSCRIBER:  'Subscriber',
    VIP:         'VIP',
    MODERATOR:   'Moderator',
    BROADCASTER: 'Broadcaster',
    DEVELOPER:   'Dev'
};
client.adminLevels = [
    client.roles.VIEWER,
    client.roles.PRIME,
    client.roles.SUBSCRIBER,
    client.roles.VIP,
    client.roles.MODERATOR,
    client.roles.BROADCASTER,
    client.roles.DEVELOPER
];
client.global = {};

function refreshTokens() {

    /* request:
    curl -X POST https://id.twitch.tv/oauth2/token \
-H '' \
-d 'grant_type=refresh_token&refresh_token=gdw3k62zpqi0kw01escg7zgbdhtxi6hm0155tiwcztxczkx17&client_id=<your client id goes here>&client_secret=<your client secret goes here>'


    expected response:
        {
  "access_token": "1ssjqsqfy6bads1ws7m03gras79zfr",
  "refresh_token": "eyJfMzUtNDU0OC4MWYwLTQ5MDY5ODY4NGNlMSJ9%asdfasdf=",
  "scope": [
    "channel:read:subscriptions",
    "channel:manage:polls" // And other scopes ofcourse
  ],
  "token_type": "bearer"
}
     */

    const options = {
        hostname: 'api.twitch.tv',
        path: '/oauth2/token',
        headers: {
            grant_type: "refresh_token",
            refresh_token: `${config.refreshToken}`,
            client_id: `${client.clientId}`,
            client_secret: `${config.secret}`,
            'Content-Type': "application/x-www-form-urlencoded"
        }
    }
    let responsetext = "";
    const data = https.get(options, r => {
        r.setEncoding('utf8');
        r.on('data', data => { responsetext = responsetext + data; });
        r.on('end', _ => { return responsetext; });
    }).on('error', err => { logError(err); return "An error occurred trying to process this command."; });

    // See if json parse succeeds, if not error occured
}

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
            const aliases = command.aliases || [];
            for (const alias of aliases) {
                client.commands.push({ name: alias, command: command });
            }
            logInfo(`Loaded command '${command.name}'${(aliases.length > 0) ? ` with aliases ['${concat(aliases, '\', \'')}']` : ''}!`);
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

////////////////
// Moderation //
////////////////

function clearChat() {
    const options = {
        hostname: 'api.twitch.tv',
        path: `/helix/moderation/chat?broadcaster_id=${config.roomId}&moderator_id=${client.clientId}`,
        headers: {
            Authorization: `Bearer ${config.ttvtoken}`,
            'Client-ID': config.twitchId
        }
    }
    let response = "";
    https.get(options, r => {
        r.setEncoding('utf8');
        r.on('data', data => { response += data; });
        r.on('end', _ => {
            logInfo('chat clear response from server:');
            logData(response);
        });
    }).on('error', err => { logError(err); });
}

function removeMessage(messageId) {
    const options = {
        hostname: 'api.twitch.tv',
        path: `/helix/moderation/chat?broadcaster_id=${config.roomId}&moderator_id=${client.clientId}&message_id=${messageId}`,
        headers: {
            Authorization: `Bearer ${config.ttvtoken}`,
            'Client-ID': config.twitchId
        }
    }
    let response = "";
    https.get(options, r => {
        r.setEncoding('utf8');
        r.on('data', data => { response += data; });
        r.on('end', _ => {
            logInfo('remove single chat message response from server:');
            logData(response);
        });
    }).on('error', err => { logError(err); });
}

////////////////////////
// Automated messages //
////////////////////////

let runMessages = false;
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
    messagesNeededBeforeAutomatedMessage = autoMsgConfig.chatsNeededBeforeAutomatedMessage < 1 ? messagesNeededBeforeAutomatedMessage : autoMsgConfig.chatsNeededBeforeAutomatedMessage;
    minutesBetweenAutomatedMessages = autoMsgConfig.minutesBetweenMessages < 1 ? minutesBetweenAutomatedMessages : autoMsgConfig.minutesBetweenMessages;
    randomizedOrder = autoMsgConfig.randomOrder || false;
    for (let i = 0; i < autoMsgConfig.messages.length; i++) {
        const message = autoMsgConfig.messages[i];
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
    if (automatedMessages.length > 0 && autoMsgConfig.enabled) { automatedMessageManager = automatedMessagesManager(); }
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
const newFollowerData = [];
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
            if (json.status) { if (json.status === 401) { logError("Token expired!"); return; } }
            if (json === undefined) { logWarning("Failed to parse follower data:"); logData(parseData); return; }
            chunk++;
            logInfo(`Parsing chunk ${chunk}/${Math.max(1, Math.ceil(json.total / amountPerChunk))}`);
            const next = `${json.pagination.cursor}`.toString();
            if (next.length > 10) { sleep(secondsPerChunk).then(_ => loadFollowers(next)); } // Only start loading next batch if a new pagination for a batch has been given from the loaded data
            for (let i = 0; i < json.data.length; i++) {
                newFollowerData.push({
                    id: json.data[i].user_id,
                    name: `${json.data[i].user_name}`,
                    time: parseTwitchTime(`${json.data[i].followed_at}`)
                });
            }
            if (chunk === Math.ceil(json.total / amountPerChunk)) {
                console.timeEnd('followers');
                // Overwrite the previous dataset
                followerData.splice(0, followerData.length);
                for (let i = 0; i < newFollowerData.length; i++) { followerData.push(newFollowerData[i]); }

                // Clean up temporary data
                newFollowerData.splice(0, newFollowerData.length);
                chunk = 0;
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
    date.setFullYear(parseInt(dateStr[0]), parseInt(dateStr[1])-1, parseInt(dateStr[2]));
    date.setHours(parseInt(timeStr[0]));
    date.setMinutes(parseInt(timeStr[1]));
    date.setSeconds(parseInt(timeStr[2]));
    return date.getTime();
}

///////////////
// Live info //
///////////////

async function isTwitchChannelLive() {
    const channel = config.channel;
    const response = await fetch(`https://api.twitch.tv/helix/streams?user_login=${channel}`, {
        method: 'GET',
        headers: {
            'Client-ID': `${config.twitchId}`,
            'Authorization': `Bearer ${config.ttvtoken}`
        }
    });
    if (!response.ok) { logWarning(`Could not fetch isLive status! http response: ${response.status}`); logData(response); return; }
    const json = await response.json();
    if (json.data.length > 0) {
        logInfo(`Channel ${channel} just went live.`);
        client.utils.streamStartTime = new Date(json.data[0].started_at).getTime();
        return true;
    } else {
        logInfo(`Channel ${channel} just went offline.`);
        client.utils.streamStartTime = client.utils.startTime;
        return false;
    }
}