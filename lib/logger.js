/**
 * Yapılandırılmış loglama
 * Seviyeler: error, warn, info, debug
 */
const levels = { error: 0, warn: 1, info: 2, debug: 3 };
const minLevel = levels[process.env.LOG_LEVEL] ?? levels.info;

function log(level, msg, meta = {}) {
  if (levels[level] > minLevel) return;
  const entry = {
    time: new Date().toISOString(),
    level,
    msg,
    ...(Object.keys(meta).length ? meta : {})
  };
  const out = level === 'error' ? console.error : console.log;
  if (process.env.LOG_JSON === 'true') {
    out(JSON.stringify(entry));
  } else {
    const suffix = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    out(`[${entry.time}] [${level.toUpperCase()}] ${msg}${suffix}`);
  }
}

module.exports = {
  error: (msg, meta) => log('error', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  debug: (msg, meta) => log('debug', msg, meta)
};
