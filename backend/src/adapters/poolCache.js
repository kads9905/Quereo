// Keeps one connection pool per saved connection and reuses it.
// Opening a fresh TCP connection + login for every query would add tens of
// milliseconds each time, and would quickly exhaust the server's connection limit.
//
// `version` is the connection's updatedAt: when the user edits host/password,
// the old pool is closed and a new one is created on next use.
const createPoolCache = ({ create, close }) => {
  const pools = new Map();

  const get = (connection, config) => {
    const key = String(connection._id);
    const version = String(connection.updatedAt?.getTime?.() ?? connection.updatedAt);
    const cached = pools.get(key);

    if (cached?.version === version) return cached.pool;
    if (cached) close(cached.pool).catch(() => {});

    const pool = create(config);
    pools.set(key, { pool, version });
    return pool;
  };

  const remove = async (connectionId) => {
    const key = String(connectionId);
    const cached = pools.get(key);
    if (!cached) return;
    pools.delete(key);
    await close(cached.pool).catch(() => {});
  };

  const clear = async () => {
    await Promise.all([...pools.keys()].map(remove));
  };

  return { get, remove, clear };
};

export { createPoolCache };
