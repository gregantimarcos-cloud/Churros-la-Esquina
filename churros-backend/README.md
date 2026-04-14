# 🥐 Churros La Esquina — Guía de instalación completa

---

## PASO 1 — Configurar Web3Forms (comprobantes de transferencia)

1. Entrá a **https://web3forms.com**
2. Poné tu email y hacé clic en "Get your Access Key"
3. Te llega un email — copiá la `access_key`
4. En el panel de administración → **Configuración** → campo **"Clave Web3Forms"** → pegá la clave
5. ¡Listo! Cuando un cliente confirma una transferencia puede adjuntar el comprobante y te llega por email

---

## PASO 2 — Subir a Railway (backend con base de datos real)

### 2.1 — Crear cuenta en GitHub
1. Entrá a **https://github.com** → "Sign up" (gratis)
2. Creá un repositorio nuevo, llamalo `churros-la-esquina`
3. Subí todos los archivos de esta carpeta (`server.js`, `package.json`, carpeta `public/`)

### 2.2 — Subir el código
Si no tenés Git instalado:
1. En tu repositorio de GitHub, hacé clic en "uploading an existing file"
2. Arrastrá todos los archivos de esta carpeta
3. Hacé clic en "Commit changes"

**Estructura que tiene que quedar en GitHub:**
```
churros-la-esquina/
├── server.js
├── package.json
└── public/
    ├── churros_cliente.html
    └── churros_admin.html
```

### 2.3 — Crear proyecto en Railway
1. Entrá a **https://railway.app** → "Start a New Project"
2. Elegí "Deploy from GitHub repo"
3. Conectá tu cuenta de GitHub y elegí el repo `churros-la-esquina`
4. Railway lo detecta automáticamente y lo despliega

### 2.4 — Configurar variables de entorno en Railway
En Railway → tu proyecto → pestaña "Variables", agregá:

| Variable | Valor |
|----------|-------|
| `MP_ACCESS_TOKEN` | Tu Access Token de Mercado Pago (ver Paso 3) |
| `BASE_URL` | La URL de tu app en Railway (ej: `https://churros-la-esquina.up.railway.app`) |
| `PORT` | `3000` |

### 2.5 — Obtener tu URL
Railway te da una URL del estilo `https://churros-la-esquina.up.railway.app`
- Esa es la URL de tu página para clientes
- El admin está en `https://churros-la-esquina.up.railway.app/churros_admin.html`

---

## PASO 3 — Integrar Mercado Pago

### 3.1 — Obtener tu Access Token
1. Entrá a **https://www.mercadopago.com.ar/settings/account/credentials**
2. Iniciá sesión con tu cuenta de vendedor
3. Elegí **"Producción"** (no prueba)
4. Copiá el **Access Token** (empieza con `APP_USR-...`)

### 3.2 — Pegarlo en Railway
- En Railway → Variables → `MP_ACCESS_TOKEN` → pegá el token

### 3.3 — Cómo funciona el flujo
Cuando un cliente elige Mercado Pago y confirma el pedido:
1. Tu servidor crea una "preferencia de pago" en MP con el monto exacto
2. MP devuelve un link de pago único
3. El cliente es redirigido a ese link
4. Cuando paga, MP notifica a tu servidor automáticamente (webhook)
5. El pedido aparece en tu panel de admin

### 3.4 — Activar webhooks en MP (opcional pero recomendado)
1. Ir a **https://www.mercadopago.com.ar/developers/panel/app**
2. Tu aplicación → Webhooks → Agregar URL:
   `https://tu-app.up.railway.app/api/mp/webhook`
3. Activar el evento: `payment`

---

## PASO 4 — Dominio propio (opcional)

Si querés usar `www.churroslaesquina.com.ar` en vez de la URL de Railway:
1. Comprá el dominio en NIC Argentina o cualquier registrador
2. En Railway → tu proyecto → Settings → Domains → "Add Custom Domain"
3. Seguí las instrucciones para apuntar el DNS

---

## Resumen de costos

| Servicio | Plan | Costo |
|----------|------|-------|
| Railway | Hobby ($5 USD/mes) o Free (500hs/mes) | Gratis o $5 USD |
| Web3Forms | Free (250 emails/mes) | Gratis |
| Mercado Pago | Comisión por venta (~4.99%) | Solo cuando vendés |
| Dominio .com.ar | — | ~$500 ARS/año |

---

## Preguntas frecuentes

**¿Los datos se pierden si Railway reinicia?**
Con el plan gratuito sí puede pasar. Con el plan Hobby ($5/mes) Railway mantiene el servidor corriendo. Para mayor seguridad podés agregar una base de datos PostgreSQL desde Railway (un clic) — avisame y te actualizo el server para usarla.

**¿Cómo accedo al panel de admin en producción?**
`https://tu-url.up.railway.app/churros_admin.html`

**¿Puedo seguir usando los HTML localmente para probar?**
Sí, los HTML con localStorage siguen funcionando igual para pruebas locales.
