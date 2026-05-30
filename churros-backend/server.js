const express = require('express');
let webpush = null;
try { webpush = require('web-push'); } catch(e) { console.log('web-push not installed, push notifications disabled'); }

// ── VAPID KEYS ──
const VAPID_PUBLIC = process.env.VAPID_PUBLIC || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || '';
console.log('VAPID_PUBLIC:', VAPID_PUBLIC ? 'SET ('+VAPID_PUBLIC.length+' chars)' : 'NOT SET');
console.log('VAPID_PRIVATE:', VAPID_PRIVATE ? 'SET' : 'NOT SET');
if(webpush && VAPID_PUBLIC && VAPID_PRIVATE){
  webpush.setVapidDetails('mailto:churroslaesquina@gmail.com', VAPID_PUBLIC, VAPID_PRIVATE);
}
let pushSubscriptions = [];
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
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
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
async function getOrders(days=60) {
  // Only fetch recent orders for performance — historial queries can pass days=365
  const r = await pool.query(
    `SELECT id, data FROM orders WHERE created_at > NOW() - ($1 || ' days')::INTERVAL ORDER BY id DESC`,
    [days]
  );
  return r.rows.map(r => ({ id: r.id, ...r.data }));
}

// ── Mercado Pago ────────────────────────────────────────────────────
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN || 'TEST-tu-access-token-aqui',
});

// ── Middleware ──────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
// Disable cache for HTML files
app.use(function(req, res, next){
  if(req.path.endsWith('.html') || req.path === '/'){
    res.setHeader('Cache-Control','no-cache, no-store, must-revalidate');
    res.setHeader('Pragma','no-cache');
    res.setHeader('Expires','0');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if(filePath.endsWith('.html')){
      // Never cache HTML files so price/product changes show immediately
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.set('Pragma', 'no-cache');
    }
  }
}));

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
  try {
    const products = await getProducts();
    // Use timestamp-based version so cache busts after any update
    const version = require('crypto').createHash('md5').update(JSON.stringify(products)).digest('hex');
    if(req.headers['if-none-match'] === version) {
      return res.status(304).end();
    }
    res.set('ETag', version);
    res.set('Cache-Control','no-cache');
    res.json(products);
  }
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
  try {
    res.set('Cache-Control','no-store');
    const slots = await getSlots();
    // Calculate real pedidosActuales from active orders (not stored count)
    const orders = await getOrders(1); // only today
    const today = new Date().toISOString().slice(0, 10);
    const slotsWithCount = slots.map(s => {
      const slotLabel = `${s.from} – ${s.to}`;
      const count = orders.filter(o =>
        o.slot === slotLabel &&
        o.status !== 'done' &&
        (o.fecha || new Date(o.ts || 0).toISOString().slice(0,10)) === today
      ).length;
      return { ...s, pedidosActuales: count };
    });
    res.json(slotsWithCount);
  }
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
  try { const days=parseInt(req.query.days)||60; res.json(await getOrders(days)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/orders', async (req, res) => {
  try {
    const body = req.body;
    if (body.slot) {
      const slots = await getSlots();
      const cfg = await getCfg();
      const slotMatch = slots.find(s => `${s.from} – ${s.to}` === body.slot && s.active);

      // ── Validar que la franja no haya vencido (buffer del servidor) ──
      if (slotMatch) {
        const orderDate = body.fecha || new Date().toISOString().slice(0, 10);
        // Calcular "hoy" en zona horaria Argentina (UTC-3) igual que el cliente
        const tzOffset = cfg.tzOffset !== undefined ? cfg.tzOffset : -3;
        const nowAR0 = new Date(Date.now() + tzOffset * 60 * 60 * 1000);
        const today = nowAR0.toISOString().slice(0, 10);
        // Los pedidos manuales del admin saltean la validación de horario
        if (orderDate === today && !body.manual) {
          // Solo validar horario si es para hoy
          // Use slot-specific buffer if set, otherwise global buffer
          const buffer = slotMatch.buffer || cfg.slotBuffer || 0;
          // Use Argentina timezone (UTC-3) for time comparisons
          const tzOffset = cfg.tzOffset !== undefined ? cfg.tzOffset : -3;
          const now = new Date();
          const nowAR = new Date(now.getTime() + tzOffset * 60 * 60 * 1000);
          const nowH = nowAR.getUTCHours();
          const nowM = nowAR.getUTCMinutes();
          const nowMinutes = nowH * 60 + nowM;
          const [toH, toM] = slotMatch.to.split(':').map(Number);
          const [frH, frM] = slotMatch.from.split(':').map(Number);
          const slotEndMinutes = toH * 60 + toM;
          const slotStartMinutes = frH * 60 + frM;
          // Compare in minutes to avoid timezone issues
          const slotEnd = new Date(); slotEnd.setHours(toH, toM, 0, 0);
          const slotStart = new Date(); slotStart.setHours(frH, frM, 0, 0);
          // Block if slot already ended (compare in AR time minutes)
          if (nowMinutes >= slotEndMinutes) {
            return res.status(409).json({ error: 'Esta franja horaria ya pasó. Por favor elegí otra.' });
          }
          // Block if within buffer window BEFORE slot starts
          if (buffer > 0 && nowMinutes >= (slotStartMinutes - buffer) && nowMinutes < slotStartMinutes) {
            return res.status(409).json({ error: 'Esta franja horaria está cerrando. Por favor elegí otra.' });
          }
          // Validar bloqueos por fecha
          const blocks = cfg.slotBlocks || [];
          const isBlocked = blocks.some(b =>
            b.date === today &&
            b.from === slotMatch.from &&
            b.to === slotMatch.to
          );
          if (isBlocked) {
            return res.status(409).json({ error: 'Esta franja horaria no está disponible para hoy.' });
          }
        }
      }

      if (slotMatch && slotMatch.maxPedidos > 0) {
        const orderDate = body.fecha || new Date().toISOString().slice(0, 10);
        const orders = await getOrders();
        const count = orders.filter(o =>
          o.slot === body.slot && o.status !== 'done' &&
          (o.fecha || new Date(o.ts || 0).toISOString().slice(0, 10)) === orderDate
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
    const orderId = r.rows[0].id;
    res.json({ id: orderId });
    // Push notification to all admins
    const items = (orderData.items||[]).map(i=>i.qty+'x '+i.name).join(', ');
    sendPushToAll(
      '🥐 Nuevo pedido #'+orderId,
      (orderData.customer||'Cliente')+' · '+items+' · $'+(orderData.total||0),
      '/churros_admin.html'
    );
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
  // ── PUSH SUBSCRIPTIONS ──────────────────────────────────────────────
// ── Health check / ping (para UptimeRobot) ──────────────────────────
app.get('/ping', (req, res) => res.json({ ok: true, ts: Date.now() }));

// Products version — lightweight check for cache invalidation
app.get('/api/products/version', async (req, res) => {
  try {
    const r = await pool.query("SELECT MAX((data->>'updatedAt')::bigint) as v FROM products");
    res.set('Cache-Control','no-store');
    res.json({ v: r.rows[0]?.v || 0 });
  } catch(e) { res.json({ v: Date.now() }); }
});

app.get('/api/push/vapid', (req, res) => {
  console.log('VAPID requested, key:', VAPID_PUBLIC ? 'present' : 'missing');
  res.json({ publicKey: VAPID_PUBLIC || null });
});

app.post('/api/push/subscribe', requireAdmin, async (req, res) => {
  try {
    const sub = req.body;
    // Avoid duplicates
    const exists = pushSubscriptions.find(s => s.endpoint === sub.endpoint);
    if (!exists) pushSubscriptions.push(sub);
    res.json({ ok: true, total: pushSubscriptions.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/push/unsubscribe', requireAdmin, async (req, res) => {
  const { endpoint } = req.body;
  pushSubscriptions = pushSubscriptions.filter(s => s.endpoint !== endpoint);
  res.json({ ok: true });
});

async function sendPushToAll(title, body, url='/churros_admin.html') {
  if (!webpush || !VAPID_PUBLIC || !VAPID_PRIVATE) return;
  const payload = JSON.stringify({ title, body, url });
  const failed = [];
  for (const sub of [...pushSubscriptions]) {
    try {
      await webpush.sendNotification(sub, payload);
    } catch(e) {
      if (e.statusCode === 410 || e.statusCode === 404) {
        // Subscription expired — remove it
        pushSubscriptions = pushSubscriptions.filter(s => s.endpoint !== sub.endpoint);
      }
    }
  }
}

app.listen(PORT, () => {
    console.log(`✅ Churros La Esquina server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('❌ DB init error:', err.message);
  process.exit(1);
});
