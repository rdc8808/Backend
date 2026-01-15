# 🚀 Deployment Instructions - CRITICAL

## ⚠️ IMPORTANTE: Evitar Pérdida de Datos

**PROBLEMA:** Cada deploy en Render borra la base de datos y conexiones sociales.

**SOLUCIÓN:** Configurar `NODE_ENV=production` en Render para usar almacenamiento persistente.

---

## 📋 Configuración en Render (HACER ESTO AHORA)

### Paso 1: Configurar Variables de Entorno

Ve a tu servicio Backend en Render:
1. Dashboard → Tu servicio Backend
2. Environment → Environment Variables
3. Agregar/actualizar estas variables:

```
NODE_ENV=production
PORT=3000
FACEBOOK_APP_ID=tu_facebook_app_id
FACEBOOK_APP_SECRET=tu_facebook_app_secret
LINKEDIN_CLIENT_ID=tu_linkedin_client_id
LINKEDIN_CLIENT_SECRET=tu_linkedin_client_secret
REDIRECT_URI=https://social-planner-api.onrender.com/auth/callback
CLIENT_URL=https://cbc.rubiconcore.com
RESEND_API_KEY=tu_resend_api_key
RESEND_FROM_EMAIL=noreply@updates.rubiconcore.com
```

**CRÍTICO:** La variable `NODE_ENV=production` es la que activa la persistencia de datos.

### Paso 2: Guardar y Redesplegar

1. Click en "Save Changes"
2. Render automáticamente hará redeploy
3. Espera a que termine el deploy

### Paso 3: Verificar que Funciona

Después del deploy, verifica en los logs de Render:
```
✓ Database file found at: /opt/render/project/data/database.json
```

Si ves ese mensaje, la persistencia está activa. ✅

---

## 🔄 Cómo Funciona la Persistencia

### Sin NODE_ENV=production:
- Base de datos: `/app/database.json` (se borra en cada deploy)
- ❌ Pierdes usuarios y conexiones

### Con NODE_ENV=production:
- Base de datos: `/opt/render/project/data/database.json` (persistente)
- ✅ Los datos sobreviven los deploys

---

## 📧 Configuración de Emails

### Dominio Verificado: ✅ updates.rubiconcore.com

Todos los emails se enviarán desde: `noreply@updates.rubiconcore.com`

### Tipos de emails que se envían:

1. **Bienvenida** - Cuando admin crea un usuario
2. **Solicitud de aprobación** - Al admin cuando colaborador envía post
3. **Confirmación** - Al colaborador cuando envía post
4. **Aprobación** - Al colaborador cuando admin aprueba
5. **Rechazo** - Al colaborador cuando admin rechaza

---

## 🔒 Seguridad

### API Key de Resend

La API key actual (`re_Q4qeguFY_CTuBidvbo3zrc6xZTbqc7eAt`) fue expuesta en GitHub.

**Pasos de seguridad:**
1. Ir a https://resend.com/api-keys
2. Eliminar la key expuesta
3. Generar nueva API key
4. Actualizar en Render: `RESEND_API_KEY=nueva_key`
5. Cerrar el alert en GitHub

### .gitignore

El archivo `.env` está excluido del repositorio para evitar exponer secretos.

**NUNCA commitear:**
- `.env`
- `database.json`
- API keys o secretos

---

## 🐛 Debug de Problemas

### Si los emails no llegan:

1. Revisa los logs de Render después de intentar enviar
2. Busca estos emojis:
   - 📧 = Intentando enviar
   - ✅ = Enviado exitosamente
   - ❌ = Error al enviar

3. Si ves errores, copia el JSON completo del error

### Si se borran los datos después de deploy:

1. Verifica que `NODE_ENV=production` esté configurado en Render
2. Revisa los logs y busca:
   ```
   ✓ Database file found at: /opt/render/project/data/database.json
   ```
3. Si dice `/app/database.json`, la variable NODE_ENV no está configurada

---

## 📝 Checklist Pre-Deploy

Antes de hacer push a GitHub:

- [ ] ¿Agregaste nuevas variables de entorno? → Actualizar en Render
- [ ] ¿Cambiaste la estructura de la base de datos? → Podría requerir migración
- [ ] ¿NODE_ENV=production está configurado en Render? → CRÍTICO
- [ ] ¿Probaste localmente? → `npm start`

---

## 🆘 Soporte

Si algo sale mal:
1. Revisa los logs de Render (Real-time logs)
2. Busca mensajes de error en rojo
3. Copia el error completo para debug
