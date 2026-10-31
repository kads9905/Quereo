-- Demo e-commerce database. It is seeded with enough rows that a missing
-- index makes a visible difference, and has a few deliberate problems:
--   * orders.customer_id and orders.status have no index (index advisor)
--   * idx_products_name is never used (unused index report)
CREATE DATABASE shop;
CREATE DATABASE shop_staging;

\c shop

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

CREATE TABLE customers (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  email       text NOT NULL UNIQUE,
  city        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id           serial PRIMARY KEY,
  name         text NOT NULL,
  category     text NOT NULL,
  price_cents  integer NOT NULL
);

CREATE TABLE orders (
  id           bigserial PRIMARY KEY,
  customer_id  integer NOT NULL REFERENCES customers(id),
  status       text NOT NULL,
  total_cents  integer NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id          bigserial PRIMARY KEY,
  order_id    bigint NOT NULL REFERENCES orders(id),
  product_id  integer NOT NULL REFERENCES products(id),
  quantity    integer NOT NULL
);

CREATE INDEX idx_products_name ON products(name);

INSERT INTO customers (name, email, city, created_at)
SELECT 'Customer ' || g,
       'customer' || g || '@example.com',
       (ARRAY['Mumbai','Pune','Delhi','Bengaluru','Chennai','Hyderabad'])[1 + g % 6],
       now() - (g || ' minutes')::interval
FROM generate_series(1, 20000) g;

INSERT INTO products (name, category, price_cents)
SELECT 'Product ' || g,
       (ARRAY['books','games','music','garden','kitchen'])[1 + g % 5],
       100 + (g * 37) % 10000
FROM generate_series(1, 500) g;

INSERT INTO orders (customer_id, status, total_cents, created_at)
SELECT (1 + (g::bigint * 7919) % 20000)::int,
       (ARRAY['pending','paid','shipped','delivered','delivered','delivered','cancelled'])[1 + g % 7],
       (500 + (g::bigint * 31) % 50000)::int,
       now() - ((g % 525600) || ' minutes')::interval
FROM generate_series(1, 400000) g;

INSERT INTO order_items (order_id, product_id, quantity)
SELECT 1 + (g % 400000), 1 + (g * 13) % 500, 1 + g % 4
FROM generate_series(1, 600000) g;

ANALYZE;

-- Staging copy of the schema with drift from shop, for the schema diff demo:
--   * customers has an extra "phone" column
--   * orders.total_cents is numeric instead of integer
--   * order_items table does not exist yet
--   * orders has an extra index
\c shop_staging

CREATE TABLE customers (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  email       text NOT NULL UNIQUE,
  city        text NOT NULL,
  phone       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id           serial PRIMARY KEY,
  name         text NOT NULL,
  category     text NOT NULL,
  price_cents  integer NOT NULL
);

CREATE TABLE orders (
  id           bigserial PRIMARY KEY,
  customer_id  integer NOT NULL REFERENCES customers(id),
  status       text NOT NULL,
  total_cents  numeric(12, 2) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_status ON orders(status);
