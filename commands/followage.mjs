export default {
    // Twitch
    name: "followage",
    async reply(client, channel, userState, params, message) {
        const follower = client.utils.isFollower(userState['user-id']);
        client.utils.sendChannelMessage(channel, follower < 0 ? "You have not followed long enough to check" : getTimeDifferenceInDays(followerData[follower].time));
    },
};

function getTimeDifferenceInDays(milliFrom, milliTo = new Date().getTime(), showMinutes = false) {
    const totalMinutes = Math.floor((milliTo - milliFrom) / 1000 / 60);
    const totalHours = Math.floor(totalMinutes / 60);
    const totalDays = Math.floor(totalHours / 24);
    const years = Math.floor(totalDays / 365);
    const days = totalDays - (years * 365);
    const hours = totalHours - (totalDays * 24);
    const minutes = totalMinutes - (totalHours * 60);
    return `${years > 0 ? `${years} years and ` : ``}${days > 0 ? `${days} days and ` : ``}${hours} hours${showMinutes ? (minutes > 0 ? ` and ${minutes} minutes` : ``) : ``}`;
}