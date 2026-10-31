// Same demo store as the SQL samples, as MongoDB documents.
// orders.customerId and orders.status deliberately have no index, and
// idx_products_name is never used (for the Index Advisor demo).
const shop = db.getSiblingDB("shop");

const cities = ["Mumbai", "Pune", "Delhi", "Bengaluru", "Chennai", "Hyderabad"];
const categories = ["books", "games", "music", "garden", "kitchen"];
const statuses = ["pending", "paid", "shipped", "delivered", "delivered", "delivered", "cancelled"];
const now = Date.now();

const insertInBatches = (collection, count, makeDoc) => {
  let batch = [];
  for (let n = 1; n <= count; n++) {
    batch.push(makeDoc(n));
    if (batch.length === 10000) {
      collection.insertMany(batch, { ordered: false });
      batch = [];
    }
  }
  if (batch.length) collection.insertMany(batch, { ordered: false });
};

insertInBatches(shop.customers, 20000, (n) => ({
  _id: n,
  name: `Customer ${n}`,
  email: `customer${n}@example.com`,
  city: cities[n % 6],
  createdAt: new Date(now - n * 60_000),
}));

insertInBatches(shop.products, 500, (n) => ({
  _id: n,
  name: `Product ${n}`,
  category: categories[n % 5],
  priceCents: 100 + ((n * 37) % 10000),
}));

insertInBatches(shop.orders, 400000, (n) => ({
  _id: n,
  customerId: 1 + ((n * 7919) % 20000),
  status: statuses[n % 7],
  totalCents: 500 + ((n * 31) % 50000),
  createdAt: new Date(now - (n % 525600) * 60_000),
}));

shop.customers.createIndex({ email: 1 }, { unique: true });
shop.products.createIndex({ name: 1 }, { name: "idx_products_name" });

// The profiler is switched on with mongod startup options in docker-compose.yml,
// because a setProfilingLevel() here wouldn't survive the restart after setup.
