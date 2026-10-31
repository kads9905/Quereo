-- Same demo store as the Postgres sample, so features can be compared across
-- database types. orders.customer_id and orders.status deliberately have no index.
CREATE DATABASE shop;
USE shop;

CREATE TABLE customers (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  email       VARCHAR(255) NOT NULL UNIQUE,
  city        VARCHAR(50) NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(100) NOT NULL,
  category     VARCHAR(50) NOT NULL,
  price_cents  INT NOT NULL,
  INDEX idx_products_name (name)
);

-- No foreign key on customer_id: InnoDB would auto-create an index for it,
-- and the index advisor demo needs that column unindexed.
CREATE TABLE orders (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  customer_id  INT NOT NULL,
  status       VARCHAR(20) NOT NULL,
  total_cents  INT NOT NULL,
  created_at   DATETIME NOT NULL
);

-- Numbers 1..1,000,000 from cross-joined digits, used to generate rows
CREATE TABLE digits (d INT);
INSERT INTO digits VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9);

CREATE VIEW numbers AS
SELECT a.d + b.d * 10 + c.d * 100 + e.d * 1000 + f.d * 10000 + g.d * 100000 + 1 AS n
FROM digits a, digits b, digits c, digits e, digits f, digits g;

INSERT INTO customers (id, name, email, city)
SELECT n, CONCAT('Customer ', n), CONCAT('customer', n, '@example.com'),
       ELT(1 + n % 6, 'Mumbai', 'Pune', 'Delhi', 'Bengaluru', 'Chennai', 'Hyderabad')
FROM numbers WHERE n <= 20000;

INSERT INTO products (id, name, category, price_cents)
SELECT n, CONCAT('Product ', n), ELT(1 + n % 5, 'books', 'games', 'music', 'garden', 'kitchen'),
       100 + (n * 37) % 10000
FROM numbers WHERE n <= 500;

INSERT INTO orders (id, customer_id, status, total_cents, created_at)
SELECT n, 1 + (n * 7919) % 20000,
       ELT(1 + n % 7, 'pending', 'paid', 'shipped', 'delivered', 'delivered', 'delivered', 'cancelled'),
       500 + (n * 31) % 50000,
       NOW() - INTERVAL (n % 525600) MINUTE
FROM numbers WHERE n <= 400000;

DROP VIEW numbers;
DROP TABLE digits;

ANALYZE TABLE customers, products, orders;

-- ANALYZE and the unique checks during the inserts above count as index
-- "reads". Start the usage counters from zero, like a DBA would before
-- measuring which indexes real traffic uses.
TRUNCATE TABLE performance_schema.table_io_waits_summary_by_index_usage;
