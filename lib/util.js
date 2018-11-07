
function delayMillis(millis) {
    return new Promise((resolve) => {
        setTimeout(resolve.bind(resolve, true), millis);
    });
}

module.exports = {
    delayMillis,
};
