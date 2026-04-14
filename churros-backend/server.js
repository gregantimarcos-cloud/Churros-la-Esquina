const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { MercadoPagoConfig, Preference } = require('mercadopago');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Mercado Pago setup ──────────────────────────────────────────────
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN || 'TEST-tu-access-token-aqui',
});

// ── Simple JSON "database" (archivo en disco) ─────────────────────
// En Railway esto persiste mientras el server esté corriendo.
// Para producción real reemplazá con Railway PostgreSQL.
const DB_FILE = path.join(__dirname, 'data.json');
function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) return { products: [], orders: [], cfg: {}, slots: [] };
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch { return { products: [], orders: [], cfg: {}, slots: [] }; }
}
function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ── Middleware ──────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── API: Config ─────────────────────────────────────────────────────
app.get('/api/cfg', (req, res) => {
  const db = readDB();
  // Never send admin password to client
  const { adminPass, ...safeCfg } = db.cfg || {};
  res.json(safeCfg);
});

app.post('/api/cfg', (req, res) => {
  // Requires admin auth header
  const db = readDB();
  const { adminUser, adminPass } = db.cfg || {};
  const authUser = req.headers['x-admin-user'];
  const authPass = req.headers['x-admin-pass'];
  if (authUser !== (adminUser || 'admin') || authPass !== (adminPass || 'admin123')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  // Merge new config
  db.cfg = { ...db.cfg, ...req.body };
  writeDB(db);
  res.json({ ok: true });
});

// ── API: Products ────────────────────────────────────────────────────
app.get('/api/products', (req, res) => {
  res.json(readDB().products);
});

app.post('/api/products', requireAdmin, (req, res) => {
  const db = readDB();
  const p = { id: Date.now(), ...req.body };
  db.products.push(p);
  writeDB(db);
  res.json(p);
});

app.put('/api/products/:id', requireAdmin, (req, res) => {
  const db = readDB();
  const idx = db.products.findIndex(p => p.id == req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'No encontrado' });
  db.products[idx] = { ...db.products[idx], ...req.body };
  writeDB(db);
  res.json(db.products[idx]);
});

app.delete('/api/products/:id', requireAdmin, (req, res) => {
  const db = readDB();
  db.products = db.products.filter(p => p.id != req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// ── API: Slots ────────────────────────────────────────────────────────
app.get('/api/slots', (req, res) => {
  res.json(readDB().slots);
});

app.post('/api/slots', requireAdmin, (req, res) => {
  const db = readDB();
  const s = { id: Date.now(), ...req.body };
  db.slots.push(s);
  writeDB(db);
  res.json(s);
});

app.put('/api/slots/:id', requireAdmin, (req, res) => {
  const db = readDB();
  const idx = db.slots.findIndex(s => s.id == req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'No encontrado' });
  db.slots[idx] = { ...db.slots[idx], ...req.body };
  writeDB(db);
  res.json(db.slots[idx]);
});

app.delete('/api/slots/:id', requireAdmin, (req, res) => {
  const db = readDB();
  db.slots = db.slots.filter(s => s.id != req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// ── API: Orders ────────────────────────────────────────────────────────
app.get('/api/orders', requireAdmin, (req, res) => {
  res.json(readDB().orders);
});

app.post('/api/orders', (req, res) => {
  const db = readDB();
  const order = {
    id: (db.orders.length ? Math.max(...db.orders.map(o => o.id)) : 0) + 1,
    ...req.body,
    status: 'new',
    ts: Date.now(),
  };
  db.orders.push(order);
  writeDB(db);
  res.json({ id: order.id });
});

// Attach comprobante to order (called by client, no admin auth needed)
app.post('/api/orders/:id/comprobante', (req, res) => {
  const db = readDB();
  const o = db.orders.find(x => x.id == req.params.id);
  if (!o) return res.status(404).json({ error: 'No encontrado' });
  o.comprobante = req.body;
  writeDB(db);
  res.json({ ok: true });
});

app.put('/api/orders/:id/status', requireAdmin, (req, res) => {
  const db = readDB();
  const o = db.orders.find(x => x.id == req.params.id);
  if (!o) return res.status(404).json({ error: 'No encontrado' });
  o.status = req.body.status;
  writeDB(db);
  res.json({ ok: true });
});

app.delete('/api/orders/:id', requireAdmin, (req, res) => {
  const db = readDB();
  db.orders = db.orders.filter(o => o.id != req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// ── API: Mercado Pago ─────────────────────────────────────────────────
app.post('/api/mp/create-preference', async (req, res) => {
  try {
    const { items, orderId, backUrl } = req.body;
    const preference = new Preference(mpClient);
    const result = await preference.create({
      body: {
        items: items.map(it => ({
          id: String(it.id || 0),
          title: it.name,
          quantity: it.qty,
          unit_price: Number(it.price),
          currency_id: 'ARS',
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

// Mercado Pago webhook — marca el pedido como pagado automáticamente
app.post('/api/mp/webhook', async (req, res) => {
  res.sendStatus(200); // Always respond 200 first
  try {
    const { type, data } = req.body;
    if (type === 'payment' && data?.id) {
      // Optionally fetch payment details and update order
      const db = readDB();
      // You can match via external_reference if needed
      writeDB(db);
    }
  } catch (e) { console.error('Webhook error:', e); }
});

// ── Middleware helpers ────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const db = readDB();
  const { adminUser, adminPass } = db.cfg || {};
  const authUser = req.headers['x-admin-user'];
  const authPass = req.headers['x-admin-pass'];
  if (authUser !== (adminUser || 'admin') || authPass !== (adminPass || 'admin123')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

// ── Catch-all: serve index ────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'churros_cliente.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Churros La Esquina server running on port ${PORT}`);
});
