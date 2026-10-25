# Prospector

Motor local de prospección y outreach para vender **AgendaOS** (agenda de citas
online para profesionales sanitarios independientes en España).

Es un clon funcional de **Enginy** (`app.enginy.ai`) construido al revés: no
se trata de imitar su interfaz, sino de traer su flujo de trabajo
— *AI Finder → listas → secuencias multicanal → inbox → analítica* — sobre
**datos reales** y ejecutándose en el portátil, sin suscripciones ni servicios
de pago.

---

## Qué hace (y qué NO hace)

| Módulo | Qué resuelve |
|---|---|
| **AI Finder** | Escribes "fisioterapeutas en Madrid" y devuelve negocios reales con web, email y teléfono. |
| **Leads** | Tabla con score 0-100 contra tu ICP, estados, notas, filtros, export CSV. |
| **Listas** | Containers de prospectos por campaña/segmento. |
| **Empresas** | Vista de negocio con señales ("usa Calendly", "sin web"...). |
| **Campañas** | Secuencias multicanal: email → LinkedIn → email → llamada, con esperas y condiciones. |
| **Tareas** | Lo que la app no puede hacer sola (conectar en LinkedIn, llamar) te lo deja en bandeja. |
| **Inbox** | Respuestas: las registras a mano y la secuencia se detiene para ese lead. |
| **Playbook** | Tu oferta, ICP, tono, prueba social y CTA. Alimenta los mensajes. |
| **Analítica** | Embudo: cuántos leads, cuántos enviados, cuántas respuestas, tareas pendientes. |
| **Ajustes** | Identidades de envío y configuración SMTP. |

**No hace**: login, multi-usuario, scraping de LinkedIn logueado, envío masivo
sin SMTP, ni integración con CRM de pago. Es una herramienta de un usuario en
local.

---

## Arranque rápido

```bash
git clone git@github.com:Adrigarfer404/prospector.git
cd prospector
npm install

# 1) Crear la base (SQLite local, cero configuración)
npx prisma db push

# 2) Cargar datos REALES (descubre negocios y los guarda)
npx tsx scripts/seed.ts
#    -> por defecto: fisioterapia en Madrid, nutrición en Valencia,
#       odontología en Barcelona, psicología en Sevilla

# 3) Arrancar
npm run dev
```

Abre <http://localhost:3000/finder>.

### ¿Los datos se mantienen al cerrar y abrir la app?

**Sí.** Todo vive en un único fichero SQLite: `prisma/dev.db`. Los leads, las
empresas, las listas, las campañas, el inbox, las tareas, tus identidades (con
la contraseña SMTP) y la configuración de IA persisten entre ejecuciones,
reinicios y días. No hay nada en memoria ni en servicios externos.

Dos avisos:

- `prisma/dev.db` **no está en el repo** (está en el `.gitignore`): si clonas
  en otro sitio empiezas con la base vacía y hay que correr `npm run setup`.
- Para no perder los prospectos, copia el fichero de vez en cuando:

  ```bash
  npm run backup          # → backups/prospector-AAAAMMDD-HHMMSS.db
  ```

  Usa `VACUUM INTO`, así que la copia es consistente aunque la app esté
  escribiendo en ese momento. Se conservan las 10 últimas. **No** uses
  `prisma migrate reset` (borra la base) ni borres `prisma/dev.db` a mano.

> `npm run setup` es idempotente: no duplica campañas ni listas, y si ya
> existe un negocio sólo lo actualiza (deduplica por email y por
> empresa+nombre).

> La base `prisma/dev.db` no está en el repo (es un artefacto local con los
> prospectos que has encontrado): se recrea con `npm run setup`. Para usar la
> búsqueda web hace falta la sesión de MiniMax del sistema
> (`~/.minimax/config.yaml` + `local-runtime.auth.json`); sin ella el Finder
> cae a OpenStreetMap/BORME y avisa por los warnings.

> El seed tarda entre 2 y 6 minutos por consulta: hace búsquedas web reales y
> verifica emails por SMTP. Para probar rápido sin red:
> `npx tsx scripts/seed.ts --skip-discovery` (deja la estructura y la campaña
> montadas, sin prospectos).

---

## De dónde salen los prospectos

| Fuente | Qué aporta | Requiere |
|---|---|---|
| **Búsqueda web (MiniMax `web_search`)** | Negocio + web + email + teléfono. Es la fuente principal: aporta el 100% de los leads contactables. | Las credenciales de MiniMax ya configuradas en tu máquina. |
| **BORME (BOE)** | Sociedades de nueva constitución con actividad sanitaria, su domicilio, su CIF y el nombre de sus administradores. | Nada. |
| **OpenStreetMap / Nominatim** | POI con teléfono y web. | Nada. |
| **Overpass** | Todos los negocios etiquetados en un radio. **No accesible desde esta red** (406). | Red sin bloqueo. |
| **Resolución de contactos** | Para los negocios que aún no tienen web (los del BORME): segunda búsqueda web por nombre + domicilio + actividad + administrador para sacar su web, email y teléfono. | Nada. |
| **Hunter.io** | Emails con score. | `HUNTER_API_KEY` (opcional). |
| **Crawler de la web del negocio** | Emails, teléfonos, equipo con nombre y apellidos, señales de agenda externa. | Nada. |
| **Verificación SMTP** | Confirma si el buzón existe (sin enviar nada). | Nada. |

### Por qué el BORME sólo no sirve (y sí combinado

El BORME es oro para tu nicho — una clínica constituida hace dos meses es un
profesional que **acaba de montar su negocio** — pero el registro mercantil no
trae web ni email. Medido en "fisioterapia en Madrid":

| Fuente | Encuentra | Con web o email |
|---|---|---|
| Nominatim | 21 negocios | 1-2 (y muchos se llaman literalmente "Fisioterapia") |
| BORME | 9 constituciones sanitarias (FISILISTIC SL, ALENTO PSICOLOGIA SLP...) | 0 |
| Web search | 15-25 negocios con web, email y teléfono | todos |

Por eso la app encadena: **BORME da el nombre y el domicilio → la búsqueda web
posterior encuentra la web y el email de esa sociedad concreta**.

### Las reglas que limpian los datos (y por qué existen)

Buscar en la web trae ruido. Estas reglas están implementadas y medidas:

| Regla | Qué evita |
|---|---|
| El nombre comercial no se descarta por llevar la palabra del sector | "Fisioterapia Puerta del Sol" es un negocio, no un servicio. Antes se perdía ~80% de los resultados de la búsqueda web. |
| Un nombre formado **sólo** por términos de servicio se descarta | "Suelo Pélvico", "Punción Seca". |
| Un nombre de persona no puede llevar dentro un término de servicio ni una palabra clínica | "Fisiorehabilitación Vicálvaro" (es la clínica) y "Teresa **Paciente**" (es un testimonio, no un profesional). |
| Un cargo al principio del bloque lo invalida | "Fundadora Psicofisio" es un encabezado. |
| **Un email = un lead** y **un email = un negocio** | Nada de "info@" repetido en 40 filas de una cadena. El email genérico (`info@`, `hola@`) sólo se asigna al contacto principal. |
| **Máximo 5 contactos por negocio**, priorizando al responsable | Una cadena con 70 profesionales no llena tu lista. |
| Si el negocio lleva el nombre de su profesional, ese profesional es el lead | "Carlos Mudarra - Nutricionista en Valencia" → lead "Carlos Mudarra". |
| Un lead sin email **ni** teléfono no se crea | No se puede contactar: no aporta nada a la lista. |

Si la base ya tiene ruido de ejecuciones anteriores:

```bash
npm run cleanup          # funde duplicados, renombra y borra lo inservible
npm run cleanup -- --dry # sólo informa, no toca nada
```

---

## Configurar el envío de email (opcional pero recomendado)

Sin SMTP la app **encola** los mensajes: los ves en Inbox/Tareas y los copias y
envías a mano. Es perfectamente utilizable, pero slow.

En **Ajustes → Identidades**:

| Campo | Ejemplo |
|---|---|
| SMTP host | `smtp.ionos.es` |
| Puerto | `587` (TLS) o `465` (SSL) |
| usuario / contraseña | tus credenciales |
| "Probar conexión" | verifica que el servidor responde |

Marca la identidad como **por defecto**. Con eso, la campaña envía de verdad.

Antes de activar una campaña con envío automático, revisa siempre la
**vista previa de mensajes**: la IA los redacta, pero tú decides.

---

## Cambiar de modelo de IA (Claude, OpenRouter, cualquier API)

El proveedor de IA es **configurable desde Ajustes → Inteligencia artificial**,
sin tocar el código ni reiniciar nada. Sirve para lo que sea: redactar
emails, extraer prospectos del Finder y hacer la búsqueda web.

| Proveedor | Modelo por defecto | Credencial | Búsqueda web propia |
|---|---|---|---|
| **MiniMax** (por defecto) | `MiniMax-M3` | Ninguna: usa la sesión del runtime local | Sí |
| **Anthropic (Claude)** | `claude-sonnet-4-5` | `x-api-key` de console.anthropic.com | Sí (`web_search_20250305`) |
| **OpenRouter** | `anthropic/claude-sonnet-4.5` | `sk-or-…` de openrouter.ai/keys | Sí (plugin `web`) |
| **Compatible con OpenAI** | el que le pongas | `Bearer <clave>` + endpoint | Si el endpoint acepta plugins |

> Ojo con la **suscripción de Claude**: las planes Pro/Max de claude.ai **no
> incluyen acceso a la API**. Para usar Claude desde la app hace falta la
> clave de la API de Anthropic (se paga por token). Si prefieres no abrirte
> una cuenta nueva, OpenRouter da acceso a Claude con una sola clave.

La tarjeta de Ajustes tiene dos botones de prueba: **"Probar modelo"** (pide
un JSON mínimo) y **"Probar búsqueda web"** (una búsqueda real). Las pruebas
**no guardan nada**: se aplican de forma temporal y se descartan.

La **búsqueda web es un servicio aparte del modelo**: cada proveedor la
implementa de otra forma (tool del servidor en Anthropic, plugin en
OpenRouter) y aquí se unifican en el mismo formato. Si eliges un proveedor sin
búsqueda propia, el modo "Automático" cae a MiniMax si está disponible en el
sistema; si no, el AI Finder avisa de que no puede descubrir prospectos.

También se puede configurar por variables de entorno (tienen prioridad sobre
lo guardado, por si despliegas en otro sitio):

```bash
AI_PROVIDER=openrouter
AI_MODEL=anthropic/claude-sonnet-4.5
AI_WEB_SEARCH_PROVIDER=openrouter
AI_API_KEY=sk-or-...
AI_BASE_URL=https://openrouter.ai/api/v1
```

Para comprobar qué está activo:

```bash
npm run test:ai           # JSON + búsqueda web con el proveedor activo
npm run test:ai:compat    # autotest de la compatibilidad con APIs tipo OpenAI
```

---

## El motor de secuencias

Una campaña es una lista ordenada de pasos:

| Tipo | Qué hace |
|---|---|
| `email` | Genera el mensaje con IA y lo envía (o lo encola). |
| `linkedin_connect` | Redacta la nota de conexión y crea la tarea manual. |
| `linkedin_message` | Redacta el mensaje de LinkedIn y crea la tarea manual. |
| `linkedin_like` | Marca "dar like a su perfil" como tarea. |
| `call` | Crea la tarea de llamada con el teléfono y un guion. |
| `wait` | Pausa (días/horas configurables). |
| `condition` | Only if → si no cumple, salta al destinatario. |

Cada paso tiene su **retardo** (`delayDays` / `delayHours`) respecto al
anterior, y `stopOnReply` corta la secuencia en cuanto el lead responde.

La campaña por defecto que crea el seed:

```
Día 0  email      (IA)  → primer contacto
Día 2  LinkedIn   (IA)  → nota de conexión
Día 5  LinkedIn   (IA)  → mensaje
Día 9  email      (IA)  → seguimiento
Día 14 llamada            → guion con teléfono
Día 19 email      (IA)  → último toque
```

---

## El nicho: autónomos y pequeños negocios sin CRM

Esto **no** es una herramienta de prospección para empresas medianas o grandes.
Está afinada para el ICP real de AgendaOS:

> **Profesionales sanitarios autónomos e independientes** (fisioterapeutas,
> nutricionistas, dentistas, psychosocial, osteópatas, logopedas) y **pequeños
> negocios de salud** con consulta propia, que gestionan las citas a mano —por
> teléfono, WhatsApp, papel o con la agenda de otro— y **que no tienen un CRM**.

Enginy se orienta a cuentas más grandes; aquí la prioridad es la cola larga de
profesionales que curran solos. El impacto está en cuatro sitios:

1. **El scoring premia al independiente y penaliza a la cadena.**
2. **El crawler clasifica el perfil de cada prospecto** y lo muestra como
   etiqueta: `Autónomo`, `Sin CRM`, `Con equipo`, `Con CRM`, `Cadena`,
   `Plataforma`.
3. **El prompt de los emails habla de su día a día**, no de "tu equipo" ni de
   "gestión de personal": huecos en la agenda, recordatorios que tiene que
   mandar a mano, pacientes que no se presentan, cobros.
4. **El AI Finder descarta cadenas, franquicias y policlínicas** al extraer los
   prospectos.

## Scoring: cómo decide quién es buen lead

El score 0-100 es **determinista** (no lo inventa la IA) para que siempre
puedas justificarlo: el motivo sale en el detalle de cada lead. La base es 22
y cada criterio suma o resta lo que peses en **Playbook → Criterios de ICP**.

| Criterio | Al cumplirse | Al no cumplirse |
|---|---|---|
| Perfil clínico/salud (cargo, empresa o sector) | +12 | −4 |
| Decide él mismo (dueño, director, autónomo) | +9 | −4 |
| Consulta privada de un solo profesional | +10 | −3 |
| Trabaja a domicilio | +7 | −3 |
| Atiende sin recepción ni apoyo | +6 | −3 |
| Practica solo o con 1-2 profesionales | +7 | −4 |
| **Gestiona las citas a mano (sin software)** | **+10** | −3 |
| Usa una agenda externa (Calendy, Doctoralia...) | +6 | −3 |
| Tiene web | +3 | −2 |
| Sin web | +4 | −2 |
| Email de contacto disponible | +9 | −3 |
| Teléfono disponible | +5 | −2 |
| Negocio pequeño (≤10 empleados) | +5 | −2 |
| Zona objetivo Madrid | +5 | −2 |
| **Es una cadena o policlínica** | **−26** | 0 |
| **Ya usa un CRM o software de pacientes** | **−18** | 0 |
| **Tiene equipo de 4+ profesionales** | **−14** | 0 |
| **Es una plataforma de citas (Doctoralia, Fresha)** | **−40** | 0 |

Los tres últimos son **criterios de exclusión**: no penalizan cuando no se
cumplen, pero hunden el score cuando sí.

> El señal más rentable para AgendaOS es **"gestiona las citas a mano"**:
> no tiene nada que sustituir ni que integrar. El segundo es **"usa una agenda
> externa"**: ya entiende el problema y ya está pagando por algo pior.

### Los seis perfiles que se detectan

Cada prospecto recibe una etiqueta con lo que se ha podido deducir de su web:

| Perfil | Qué significa | ¿Interesa? |
|---|---|---|
| `Profesional independiente` | Consulta privada, un solo profesional. | Sí, es el ICP ideal. |
| `Pequeño negocio sin CRM` | Varios profesionales, sin software de pacientes. | Sí. |
| `Pequeño negocio con equipo` | 2+ profesionales en un solo centro. | Sí, pero con menos encaje. |
| `Ya tiene CRM` | Usa software de gestión de pacientes. | No. |
| `Cadena o policlínica` | Varias sedes o franquicia. | No. |
| `Plataforma de citas` | Doctoralia, Fresha, Calendly... | No. |

Para distinguirlos se mira: los profesionales con **cargo** en la web, los que
aparecen en la **página de equipo** (un testimonio de paciente en la home no
cuenta), si el negocio **lleva el nombre de su profesional** ("Fisioterapia
Barón" → consulta privada) y si usa **software de pacientes**.

---

## Estructura

```
prisma/schema.prisma        Modelo de datos (SQLite)
src/lib/
  db.ts                      Cliente Prisma
  workspace.ts               Workspace único + playbook
  scoring.ts                 Motor de scoring ICP
  messages.ts                Generación de mensajes con IA (plantilla + fallback)
  campaigns.ts               Motor de secuencias multicanal
  emailer.ts                 Envío SMTP
  pipeline.ts                Descubrir → persistir → enriquecer → puntuar
  ai/                        Capa de IA intercambiable
    index.ts                 Resolución de ajustes + despacho al proveedor
    anthropic.ts             API de Messages (Anthropic y proxy MiniMax)
    openai.ts                API de Chat Completions (OpenRouter y compatibles)
    types.ts                 Proveedores, modelos y ajustes
  providers/
    contract.ts              Interfaces de los providers
    minimax.ts               Cliente MiniMax (texto + web_search)
    finder.ts                AI Finder (búsqueda web + extracción)
    discovery/               Overpass, Nominatim, BORME
    enrichment/              Crawler de webs, emails, SMTP, Hunter
src/app/api/                API REST
src/app/(app)/               Interfaz
scripts/seed.ts              Carga datos reales
scripts/test-finder.ts       Test del AI Finder
scripts/test-ai.ts           Test del proveedor de IA activo
scripts/test-ai-compat.ts   Autotest de compatibilidad con APIs tipo OpenAI
```

---

## Comandos

```bash
npm run setup          # prisma db push + seed con datos reales
npm run dev            # desarrollo
npm run build          # build de producción
npm run typecheck      # tipos
npm run db:studio      # inspector de la base

npm run seed                                  # carga real (4 consultas por defecto)
npm run seed -- --skip-discovery             # sólo estructura, sin red
npm run seed -- --queries "fisioterapia en Madrid" --limit 30 --enrich 10

npm run test:finder -- "dentistas en Sevilla"   # AI Finder contra la web real
npm run test:providers                          # discovery + crawl + SMTP + LLM
npm run test:messages                           # redacción de emails con IA
npm run test:crawl -- https://clinicaelviso.es  # extracción de contactos de una web
npm run test:e2e                                # flujo completo contra la API (con npm run dev)

npm run cleanup                                 # limpia duplicados y leads inservibles
npm run cleanup -- --dry                        # sólo informa
```

`npm run test:e2e` recorre: analítica → playbook → leads con email → alta en
lista → campaña de 3 pasos → destinatarios → vista previa con IA → ejecución →
tareas manuales → respuesta en inbox → export CSV.

---

## Notas de operación

- **La búsqueda web usa tu sesión de MiniMax** (`~/.minimax/config.yaml` +
  `local-runtime.auth.json`). Si no está, el Finder cae a OpenStreetMap/BORME
  y avisa por los warnings.
- **Verificación SMTP**: se conecta al MX y pregunta por el buzón, **sin enviar
  ningún correo**. Algunos operadores bloquean el puerto 25; si es tu caso,
  el Finder seguirá funcionando con los emails que aparecen en los snippets.
- **La IA redacta, tú decides.** El prompt de los emails prohíbe explícitamente
  los clichés de IA y le pide no inventar datos.
- **Datos personales**: cumples el RGPD. El bloquelist está en el modelo y el
  export CSV incluye todos los campos para que puedas filtrar antes de
  exportar.

---

## Limitaciones reales (medidas, no supuestas)

Esto es lo que **no** funciona o va flojo, con datos de esta máquina:

| Limitación | Detalle |
|---|---|
| **Overpass no es accesible** | `overpass-api.de` devuelve 406/502 desde esta red y los mirrors están caídos o sin datos de España. La integración está implementada y hace *probe* con timeout corto, pero cae a Nominatim + BORME + búsqueda web. |
| **Cobertura de OSM en España es escasa** | "fisioterapia Madrid" da ~40 places; "podólogo Bilbao" da 0. Para volumen hay que apoyarse en la búsqueda web y el BORME. |
| **Cobertura del BORME es provincial** | Cada provincia publica en rotación: un día puede no haber nada en Valencia. El proveedor barre una ventana de 10 días por provincia. |
| **Verificación SMTP** | Funciona de verdad en la mayoría de dominios (`verified` con RCPT TO 250). Los hosted en IONOS responden `554 Bad DNS PTR` y quedan como `unverified`, no como error. |
| **Sin scraping de LinkedIn** | Deliberado. Se detectan URLs públicas de perfiles para que las revises, pero no se automatiza ni se hace login. |
| **La IA redacta, no decide** | Los mensajes salen del playbook y de los datos observados del negocio. El prompt prohíbe inventar datos y los clones de IA. |
| **Los ficheros del seed no son un envío** | Sin SMTP configurado los mensajes quedan en Inbox/Tareas para que los envíes a mano. Es slow, pero no falla. |
| **Un usuario, local** | No hay login, ni multi-equipo, ni sincronización. SQLite en `prisma/dev.db`. |

---

## Lo que se puede cambiar para vender mejor

1. **Playbook → Criterios de ICP**: ajusta pesos. El perfil ya está prefiltrado
   por el tipo de profesional, así que aquí decides a quién priorizas: si tu
   mejor cliente es el que ya usa Calendly, sube "usa una agenda externa" y
   baja "gestiona las citas a mano".
2. **Playbook → Tono y CTA**: define el CTA una vez y se aplica a todos los
   emails y mensajes de LinkedIn.
3. **La lista manda**: cada campaña se lanza sobre una lista, no sobre "todos
   los leads". Empieza con 20-30 prospectos de score >70, mido y escala.
4. **Señales como ángulo**: el crawler marca "gestiona las citas a mano
   (teléfono, WhatsApp o papel)" y "usa un planificador de citas externo
   (doctoralia.es)". Eso es literalmente el pitch de AgendaOS: no competir con
   el médico, sustituir su agenda.
5. **Filtra por perfil antes de filtrar por score**: en `/leads` puedes quedarte
   sólo con `Profesional independiente` o `Pequeño negocio sin CRM`.
