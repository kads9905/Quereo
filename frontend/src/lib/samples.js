// The demo databases from Quereo's docker-compose.yml, for one-click setup
export const SAMPLES = {
  postgres: {
    host: "localhost", port: 5433, database: "shop", username: "postgres", password: "postgres",
    query: "SELECT id, total_cents, created_at\nFROM orders\nWHERE customer_id = 42;",
  },
  mysql: {
    host: "127.0.0.1", port: 3307, database: "shop", username: "root", password: "mysql",
    query: "SELECT id, total_cents, created_at\nFROM orders\nWHERE customer_id = 42;",
  },
  mongodb: {
    host: "127.0.0.1", port: 27018, database: "shop", username: "mongo", password: "mongo",
    query: '{\n  "find": "orders",\n  "filter": { "customerId": 42 }\n}',
  },
};
