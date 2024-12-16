import fs from "node:fs";

export function getTimeString(date = new Date()) { return `${date.getDate()}-${date.getMonth()}-${date.getFullYear()} ${date.toLocaleTimeString()}`.toString(); }

// Log functions
export function logError(err)   { console.error(`[${getTimeString()}] ERROR:\t`, err ); }
export function logWarning(err) { console.error(`[${getTimeString()}] Warning:`, err ); }
export function logInfo(info)   { console.log  (`[${getTimeString()}] Info:\t` , info); }
export function logData(data)   { console.log  (data); }
export async function sleep(seconds) { return new Promise(resolve => setTimeout(resolve, Math.max(seconds, 0) * 1000)); }

export function equals(first, second) {
    switch (first) {
        case second: return true;
        default: return false;
    }
}

export function contains(array, value) { for (let i = 0; i < array.length; i++) { if (equals(array[i], value)) { return true; } } return false; }

export function randomInt(min, max) { return Math.floor(Math.min(+min, +max)) + Math.floor(Math.random() * (Math.max(+min, +max) - Math.min(+min, +max))); }

export function concat(list, separator = "", prefix = "", start = 0, count = list.length) {
    const end = Math.min(start + count, list.length);
    let result = "";
    for (let i = start; i < end; i++) { result += (i <= start ? "" : separator) + prefix + list[i]; }
    return result;
}

export function readFile(filePath) {
    try {
        const data = fs.readFileSync(path, 'utf8').split("\n");
        const lines = [];
        for (let i = 0; i < data.length; i++) {
            let line = data[i];
            if (line.endsWith("\r")) { line = line.substring(0, line.length - 1); } // Make sure lines don't end with the first half of the windows end line characters
            line.trim(); // Make sure lines don't start end with a spaces
            if (line.length) { lines.push(line); }
        }
        return lines;
    } catch (err) { logError(err); return []; }
}