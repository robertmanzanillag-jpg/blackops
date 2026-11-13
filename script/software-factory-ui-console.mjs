// Only Chromium's native resource failure corresponding to the measured initial
// unauthenticated session request is expected. Application console errors remain failures.
export function isExpectedInitialSessionError(error, responses, origin) {
    return responses.length === 1 && responses[0].url === `${origin}/api/auth/me`
        && responses[0].method === 'GET' && responses[0].status === 401
        && responses[0].phase === 'initial'
        && error.phase === 'initial' && error.url === `${origin}/api/auth/me`
        && error.text === 'Failed to load resource: the server responded with a status of 401 (Unauthorized)'
        && error.argumentCount === 0 && error.lineNumber === 0 && error.columnNumber === 0;
}
