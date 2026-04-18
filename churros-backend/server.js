const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const { MercadoPagoConfig, Preference } = require('mercadopago');

const app = express();
const PORT = process.env.PORT || 3000;

// ── PostgreSQL ──────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
      id BIGINT PRIMARY KEY,
      data JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS slots (
      id BIGINT PRIMARY KEY,
      data JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('✅ Database tables ready');
}

async function getCfg() {
  const r = await pool.query("SELECT value FROM config WHERE key='main'");
  return r.rows[0]?.value || {};
}
async function setCfg(cfg) {
  await pool.query(
    "INSERT INTO config(key,value) VALUES('main',$1) ON CONFLICT(key) DO UPDATE SET value=$1",
    [JSON.stringify(cfg)]
  );
}
async function getProducts() {
  const r = await pool.query('SELECT data FROM products ORDER BY id');
  return r.rows.map(r => r.data);
}
async function getSlots() {
  const r = await pool.query('SELECT data FROM slots ORDER BY id');
  return r.rows.map(r => r.data);
}
async function getOrders() {
  const r = await pool.query('SELECT id, data FROM orders ORDER BY id DESC');
  return r.rows.map(r => ({ id: r.id, ...r.data }));
}

// ── Mercado Pago ────────────────────────────────────────────────────
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN || 'TEST-tu-access-token-aqui',
});

// ── Middleware ──────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth ────────────────────────────────────────────────────────────
async function requireAdmin(req, res, next) {
  const cfg = await getCfg();
  const authUser = req.headers['x-admin-user'];
  const authPass = req.headers['x-admin-pass'];
  const defaultUser = process.env.ADMIN_USER || 'admin';
  const defaultPass = process.env.ADMIN_PASS || 'admin123';
  if (authUser !== (cfg.adminUser || defaultUser) || authPass !== (cfg.adminPass || defaultPass)) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

// ── Config ──────────────────────────────────────────────────────────
app.get('/api/cfg', async (req, res) => {
  try {
    const cfg = await getCfg();
    const { adminPass, ...safeCfg } = cfg;
    res.json(safeCfg);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/cfg', async (req, res) => {
  try {
    const cfg = await getCfg();
    const authUser = req.headers['x-admin-user'];
    const authPass = req.headers['x-admin-pass'];
    const defaultUser = process.env.ADMIN_USER || 'admin';
    const defaultPass = process.env.ADMIN_PASS || 'admin123';
    if (authUser !== (cfg.adminUser || defaultUser) || authPass !== (cfg.adminPass || defaultPass)) {
      return res.status(401).json({ error: 'No autorizado' });
    }
    await setCfg({ ...cfg, ...req.body });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Products ────────────────────────────────────────────────────────
app.get('/api/products', async (req, res) => {
  try { res.json(await getProducts()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/products', requireAdmin, async (req, res) => {
  try {
    const id = Date.now();
    const p = { id, ...req.body };
    await pool.query('INSERT INTO products(id,data) VALUES($1,$2)', [id, JSON.stringify(p)]);
    res.json(p);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/products/:id', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT data FROM products WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const updated = { ...r.rows[0].data, ...req.body };
    await pool.query('UPDATE products SET data=$1 WHERE id=$2', [JSON.stringify(updated), req.params.id]);
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/products/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Slots ───────────────────────────────────────────────────────────
app.get('/api/slots', async (req, res) => {
  try { res.json(await getSlots()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/slots', requireAdmin, async (req, res) => {
  try {
    const id = Date.now();
    const s = { id, ...req.body };
    await pool.query('INSERT INTO slots(id,data) VALUES($1,$2)', [id, JSON.stringify(s)]);
    res.json(s);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/slots/:id', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT data FROM slots WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const updated = { ...r.rows[0].data, ...req.body };
    await pool.query('UPDATE slots SET data=$1 WHERE id=$2', [JSON.stringify(updated), req.params.id]);
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/slots/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM slots WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Orders ──────────────────────────────────────────────────────────
app.get('/api/orders', requireAdmin, async (req, res) => {
  try { res.json(await getOrders()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/orders', async (req, res) => {
  try {
    const body = req.body;
    if (body.slot) {
      const slots = await getSlots();
      const slotMatch = slots.find(s => `${s.from} – ${s.to}` === body.slot && s.active);
      if (slotMatch && slotMatch.maxPedidos > 0) {
        const today = new Date().toDateString();
        const orders = await getOrders();
        const count = orders.filter(o =>
          o.slot === body.slot && o.status !== 'done' &&
          new Date(o.ts || 0).toDateString() === today
        ).length;
        if (count >= slotMatch.maxPedidos) {
          return res.status(409).json({ error: 'Esta franja horaria ya está completa. Por favor elegí otra.' });
        }
        const updated = { ...slotMatch, pedidosActuales: (slotMatch.pedidosActuales || 0) + 1 };
        await pool.query('UPDATE slots SET data=$1 WHERE id=$2', [JSON.stringify(updated), slotMatch.id]);
      }
    }
    const orderData = { ...body, status: 'new', ts: Date.now() };
    const r = await pool.query('INSERT INTO orders(data) VALUES($1) RETURNING id', [JSON.stringify(orderData)]);
    res.json({ id: r.rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/orders/:id/comprobante', async (req, res) => {
  try {
    const r = await pool.query('SELECT data FROM orders WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const updated = { ...r.rows[0].data, comprobante: req.body };
    await pool.query('UPDATE orders SET data=$1 WHERE id=$2', [JSON.stringify(updated), req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/orders/:id/status', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT data FROM orders WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const updated = { ...r.rows[0].data, status: req.body.status };
    await pool.query('UPDATE orders SET data=$1 WHERE id=$2', [JSON.stringify(updated), req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/orders/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM orders WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Stock deduction ─────────────────────────────────────────────────
app.post('/api/stock/deduct', async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) return res.json({ ok: true });
    for (const item of items) {
      const r = await pool.query('SELECT id,data FROM products WHERE id=$1', [item.id]);
      if (r.rows.length) {
        const p = r.rows[0].data;
        if (!p.unlimited && p.stock > 0) {
          p.stock = Math.max(0, p.stock - (item.qty || 1));
          await pool.query('UPDATE products SET data=$1 WHERE id=$2', [JSON.stringify(p), r.rows[0].id]);
        }
      }
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Mercado Pago ────────────────────────────────────────────────────
app.post('/api/mp/create-preference', async (req, res) => {
  try {
    const { items, orderId, backUrl } = req.body;
    const preference = new Preference(mpClient);
    const result = await preference.create({
      body: {
        items: items.map(it => ({
          id: String(it.id || 0), title: it.name,
          quantity: it.qty, unit_price: Number(it.price), currency_id: 'ARS',
        })),
        external_reference: String(orderId),
        back_urls: {
          success: backUrl + '?mp=success&order=' + orderId,
          failure: backUrl + '?mp=failure&order=' + orderId,
          pending: backUrl + '?mp=pending&order=' + orderId,
        },
        auto_return: 'approved',
        notification_url: process.env.BASE_URL + '/api/mp/webhook',
      },
    });
    res.json({ init_point: result.init_point, id: result.id });
  } catch (e) {
    console.error('MP error:', e);
    res.status(500).json({ error: 'Error al crear preferencia de pago' });
  }
});

app.post('/api/mp/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const { type, data } = req.body;
    if (type === 'payment' && data?.id) {
      console.log('MP webhook payment:', data.id);
    }
  } catch (e) { console.error('Webhook error:', e); }
});

// ── Catch-all ───────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'churros_cliente.html'));
});

// ── Start ───────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Churros La Esquina server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('❌ DB init error:', err.message);
  process.exit(1);
});
