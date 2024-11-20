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