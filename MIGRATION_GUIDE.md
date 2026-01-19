# 🔄 Guía de Migración a PostgreSQL

## ¿Por qué PostgreSQL?

**PROBLEMA:** Render FREE no tiene almacenamiento persistente. Cada reinicio del servicio borra `database.json` y pierdes usuarios/posts/conexiones.

**SOLUCIÓN:** PostgreSQL persiste los datos permanentemente. Render ofrece PostgreSQL gratis por 30 días (1GB).

---

## 📋 Pasos de Migración

### 1. Crear Base de Datos en Render

1. Ve a https://dashboard.render.com/
2. Click "**New +**" → "**PostgreSQL**"
3. Configuración:
   - **Name:** `social-planner-db`
   - **Database:** `socialplanner`
   - **User:** (auto-generado)
   - **Region:** Mismo que tu Backend
   - **Plan:** **Free** (1GB, 30 días gratis)
4. Click "**Create Database**"
5. Espera 2-3 minutos a que se cree

### 2. Obtener la Connection String

1. En Render → Tu base de datos PostgreSQL
2. Scroll abajo hasta "**Connections**"
3. Copia el "**Internal Database URL**"
   - Se ve así: `postgresql://user:pass@dpg-xxxxx/dbname`
   - **USA LA INTERNAL URL** (más rápida, sin límites)

### 3. Configurar en Render

1. Ve a tu servicio **Backend**
2. Environment → Environment Variables
3. Agregar nueva variable:
   - **Key:** `DATABASE_URL`
   - **Value:** (pega la Internal Database URL que copiaste)
4. Click "**Save Changes**"
5. Espera el redeploy

---

## ✅ Verificar que Funciona

Después del deploy, ve a **Logs** y busca:

```
✅ PostgreSQL database initialized successfully
```

Si ves eso → **FUNCIONÓ PERFECTAMENTE**

---

## 🔄 Migrar Datos Existentes (Opcional)

Si tenías usuarios en `database.json` y quieres migrarlos:

### Opción 1: Manual (Recomendado si son pocos)

1. Anota los emails/passwords de database.json
2. Créalos de nuevo en la plataforma web
3. Listo, ahora están en PostgreSQL

### Opción 2: Script de Migración (Si tienes muchos)

```bash
cd "/Users/andres/Desktop/Social Planner/Backend"
node migrate-json-to-pg.js
```

---

## 📊 Ventajas de PostgreSQL

✅ **Persistencia:** Datos NUNCA se borran
✅ **Confiable:** Base de datos real, no archivo JSON
✅ **Escalable:** Soporta miles de usuarios/posts
✅ **Concurrent:** Múltiples requests simultáneos sin problemas
✅ **Backups:** Render hace backups automáticos

---

## ⚠️ Importante: Free Tier Limits

- **Duración:** 30 días gratis
- **Storage:** 1GB (suficiente para ~10,000 usuarios)
- **Después de 30 días:** $7/mes o se borra

**Alternativa después de 30 días:**
- Crear nueva base de datos free (otro mes gratis)
- Migrar a plan paid ($7/mes)
- Usar otro servicio (Railway, Supabase, etc.)

---

## 🆘 Troubleshooting

### "Cannot connect to database"
- Verifica que copiaste la **Internal Database URL**
- Verifica que DATABASE_URL esté en Environment Variables
- Espera 2-3 min después de crear la DB

### "Database does not exist"
- La DB tarda en inicializarse
- Reinicia el servicio Backend manualmente

### "Timeout connecting to database"
- Usa Internal URL, NO External URL
- Verifica que Backend y DB estén en la misma región

---

## 📝 Notas

- Los datos en PostgreSQL persisten incluso después de redeploys
- No necesitas NODE_ENV=production para persistencia con PostgreSQL
- database.json ya no se usa (puedes borrarlo después de migrar)
