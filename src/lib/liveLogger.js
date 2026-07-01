const PREFIX = '[live]';

function log(event, details = {}) {
  const payload = Object.keys(details).length ? ` ${JSON.stringify(details)}` : '';
  console.log(`${PREFIX} ${event}${payload}`);
}

function logError(event, err, details = {}) {
  const msg = err?.message || String(err);
  console.error(`${PREFIX} ${event}: ${msg}`, details);
}

module.exports = { log, logError };
