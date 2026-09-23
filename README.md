# Tablero de features en Notion

Sincroniza el estado de las features de un repositorio (documentos ODD en
`odd/tasks/*.md`) hacia una base de datos de Notion, para tener un tablero
siempre actualizado sin mantenerlo a mano.

## Qué hace y por qué

Cada documento `odd/tasks/<slug>.md` describe una feature: su lista de
tareas, las ramas y (opcionalmente) los commits asociados. Este script lee
todos esos documentos, calcula una fila por feature y la sincroniza (alta o
actualización, nunca borrado) contra una base de Notion.

Ideas centrales:

- **Una fila por feature, nunca a mano.** El estado, el progreso, la tarea
  pendiente, los PRs abiertos, las ramas vivas y los días sin actividad se
  calculan a partir de los documentos y de GitHub (`git` y `gh`). Nadie edita
  esos campos directamente en Notion: la corrida siguiente los pisa.
- **El estado se deriva, nunca se escribe a mano.** No hay una columna donde
  alguien tipee "En curso" o "Terminada" — sale de las tareas marcadas, de si
  quedan PRs abiertos, y de nada más (ver más abajo "Cómo se deriva el
  estado").
- **La vista de estancadas.** Con "Días sin actividad" como columna
  ordenable, la base de Notion se puede filtrar u ordenar para ver primero
  las features que hace más tiempo que nadie toca — sin ese número, esas
  features quedan escondidas entre las demás.
- **Nunca borra.** Una página de Notion cuyo slug ya no tiene documento
  correspondiente se informa como "huérfana" en la salida, pero no se
  elimina: borrar es una decisión humana.

## Requisitos

- Node.js 22 o superior.
- `git`, con el repositorio clonado completo (`fetch-depth: 0` en CI): un
  clon superficial no tiene las fechas de commit ni las ramas remotas
  completas que este script necesita.
- El CLI [`gh`](https://cli.github.com/) autenticado (`gh auth login`): el
  script lee los pull requests del repositorio con `gh pr list`, no con la
  API de GitHub directamente.

## Instalación

```bash
npm ci
```

## Crear la base en Notion

1. Andá a <https://www.notion.so/developers> y creá una **integración
   interna** para tu workspace. Dale capacidades de **lectura, actualización
   e inserción de contenido** (sin esas tres, el script no puede leer el
   esquema, ni crear páginas, ni actualizarlas).
2. Creá una base de datos nueva con el tipo **"Tabla - página completa"**
   ("Table - full page").
3. Agregale estas 11 propiedades, con este **nombre y tipo exactos** (Notion
   distingue mayúsculas/minúsculas y tildes; un nombre que no coincida se
   reporta como propiedad faltante):

   | Propiedad | Tipo |
   |---|---|
   | Feature | Title |
   | Slug | Text (rich text) |
   | Estado | Select |
   | Progreso | Text (rich text) |
   | Pendiente | Text (rich text) |
   | PRs abiertos | Text (rich text) |
   | Ramas | Text (rich text) |
   | Días sin actividad | Number |
   | Actualizado | Date |
   | Documento | URL |
   | Huella | Text (rich text) |

   Si en algún momento renombrás o retipás una de estas columnas en Notion,
   tenés que actualizar también la constante `ESQUEMA_ESPERADO` en
   `src/sync-tablero-features.ts` — los dos lados del contrato viven ahí y en
   Notion, ninguno se puede descubrir del otro automáticamente.
4. Compartí la base con la integración: abrí la base, tocá el menú `•••` de
   arriba a la derecha → **Connections** (Conexiones) → buscá y agregá la
   integración que creaste en el paso 1. Sin este paso, cualquier llamada del
   script devuelve un error de permisos aunque el token sea válido.
5. Sacá el ID de la base de su URL. Abrí la base en el navegador; la URL se
   ve más o menos así:

   ```
   https://www.notion.so/miworkspace/Tablero-de-features-a1b2c3d4e5f67890a1b2c3d4e5f67890?v=...
   ```

   El ID son los **32 caracteres hexadecimales** que aparecen justo antes del
   `?` (en el ejemplo, `a1b2c3d4e5f67890a1b2c3d4e5f67890`). También podés
   pegar la URL completa tal cual: `normalizarIdBaseNotion` la reconoce y
   descarta el `?v=...`, que identifica la VISTA, no la base. **No** uses la
   opción "Copy data source ID" del menú de Notion: ese ID pertenece a un
   objeto distinto de la API (el "data source", una capa que Notion agregó
   en 2025 dentro de cada base) y no es lo que este script espera en
   `NOTION_TABLERO_DB_ID`.

## Configuración

Copiá `.env.example` a `.env` y completá las dos variables obligatorias:

```bash
NOTION_TOKEN=secret_...
NOTION_TABLERO_DB_ID=a1b2c3d4e5f67890a1b2c3d4e5f67890
```

Dos variables opcionales, con su valor por defecto entre paréntesis, permiten
adaptar el script a un repositorio con otra estructura:

- `TABLERO_CARPETA` (`odd/tasks`): carpeta donde viven los documentos,
  relativa a la raíz del repositorio.
- `TABLERO_RAMA_BASE` (`main`): rama base que se usa para armar el enlace de
  la propiedad "Documento" de cada fila.

## Uso

**`npm run sync:dry` sin credenciales** (sin `.env`, o con `.env` incompleto):
no se hace ninguna llamada de red a Notion ni a GitHub más que las de
`git`/`gh` para calcular las filas. Imprime, por cada documento válido, la
fila que se calcularía (slug, estado, progreso, PRs abiertos, días sin
actividad, fecha de actualización) y termina con `Errores de formato: N`. Es
el modo que usa el job de validación en pull requests: nunca imprime
contadores de Notion ("Creadas:", "Actualizaría:", etc.), porque esos números
no se calcularon.

**`npm run sync:dry` con credenciales**: además de lo anterior, consulta
Notion en modo lectura (esquema, páginas existentes) y muestra el plan
completo — cuántas páginas crearía, cuántas actualizaría, a cuántas les
reescribiría el cuerpo, y cuáles quedarían huérfanas — sin escribir nada
todavía.

**`npm run sync`**: ejecuta la sincronización real contra Notion. Termina con
código de salida distinto de cero si hubo algún error de formato en un
documento o algún slug duplicado en Notion, aunque el resto de las features
se haya sincronizado sin problemas.

## Automatización

> En este repositorio plantilla el workflow está **desactivado**, para que no aparezca en rojo sin credenciales. Al adoptarlo, activalo en la pestaña Actions después de cargar los dos secrets.

El workflow `.github/workflows/sync-tablero-notion.yml` corre en cuatro
disparadores:

1. **`push`** a la rama base, cuando cambia algo relevante (un documento en
   `odd/tasks/`, el propio script, el workflow, o `package.json`/
   `package-lock.json`): sincroniza de verdad.
2. **`pull_request`** sobre esos mismos caminos: solo valida el formato de
   los documentos (`sync:dry`, sin credenciales), para cortar con un PR en
   rojo antes del merge si algún documento quedó mal formado.
3. **`schedule`** (cron diario): un push por sí solo no alcanza para
   mantener el tablero al día, porque "Días sin actividad" cambia con el
   sólo paso del tiempo y el merge de un PR no siempre toca un documento.
   Sin esta corrida diaria, el tablero se congela entre ediciones.
4. **`workflow_dispatch`**: para forzar una corrida manual.

Necesita dos secrets configurados en el repositorio (**Settings → Secrets
and variables → Actions**): `NOTION_TOKEN` y `NOTION_TABLERO_DB_ID`. Si
faltan, el job de sincronización corta en segundos con un error explícito,
antes de instalar nada — nunca informa un éxito que en realidad no escribió
nada.

## Contrato del formato del documento

Cada documento vive en `<TABLERO_CARPETA>/<slug>.md` y tiene esta forma
mínima:

```markdown
---
ramas: ["docs/odd-<slug>", "feat/<slug>*"]
---

# Título legible de la feature

## Tareas

- [ ] **T1 — Nombre corto**: descripción.
- [ ] **QA1 — Prueba manual**: descripción.
```

Reglas:

- **`ramas`** (obligatoria, en el frontmatter): array JSON de patrones glob
  (solo `*` como comodín) que tienen que cubrir cada rama que use la
  feature. Una rama que no matchea ningún patrón no cuenta para "Ramas",
  "PRs abiertos" ni para calcular la fecha de actividad.
- **`commits`** (opcional): array JSON de hashes de commit **completos** (40
  caracteres hexadecimales en minúscula) hechos directo a la rama base, sin
  PR ni rama propia. Sirve de ancla de actividad para ese tipo de trabajo,
  que de otro modo no tendría ninguna fecha asociada. Requiere un clon
  completo del repositorio (sin `fetch-depth: 0`, se reporta como error de
  entorno).
- **Una única sección `## Tareas`**: cualquier otro encabezado de nivel 2
  cierra la sección. Tener cero, o más de una, sección `## Tareas` es un
  error de formato.
- **IDs `T1`, `T2`, ... para trabajo, `QA1`, `QA2`, ... para pruebas
  manuales**: el prefijo `QA` es lo único que distingue una tarea de una
  prueba manual a los efectos de derivar el estado. El ID va en negrita al
  principio del checkbox, separado del nombre por una raya (`—`, no un
  guion común); la descripción después de los dos puntos es opcional.
- **Los bloques de código se ignoran**: un ` ```markdown ` con un ejemplo de
  frontmatter o de sección `## Tareas` adentro no cuenta como el frontmatter
  ni la sección reales del documento.

Un ejemplo completo, con una tarea hecha y una pendiente más una prueba
manual pendiente, vive en [`odd/tasks/ejemplo-feature.md`](odd/tasks/ejemplo-feature.md).

## Cómo se deriva el estado

En este orden de precedencia:

1. **Terminada**: hay al menos una tarea, todas están marcadas como hechas,
   y no queda ningún PR abierto sobre las ramas de la feature.
2. **QA pendiente**: quedan tareas sin hacer, y todas las que quedan sin
   hacer son de QA (prefijo `QA`).
3. **Sin empezar**: ninguna tarea está marcada como hecha.
4. **En curso**: cualquier otra combinación (por ejemplo, con tareas hechas
   y no-QA pendientes, o con todo hecho pero un PR todavía abierto).

La fecha de "Actualizado" (y de ahí "Días sin actividad") toma la más
reciente entre: el commit de cada rama viva que matchea, el momento en que
se mergeó o cerró cada PR relacionado (o se abrió, si sigue abierto), y la
fecha de cada commit ancla declarado en `commits`. A falta de todo eso, cae
a la fecha del propio documento y, si tampoco existe, a la fecha de la
corrida.

**Nunca se usa el `updatedAt` que devuelve GitHub para un pull request.** Ese
campo se mueve con eventos que no son trabajo real sobre la feature — por
ejemplo, la limpieza de una rama vieja actualiza el PR mergeado semanas
atrás — y usarlo escondería features genuinamente estancadas detrás de una
fecha reciente que no significa nada.

## Límites conocidos

- Solo ve lo que llegó a GitHub: un commit local sin pushear, o una rama que
  vive solo en una máquina, son invisibles para este script.
- Una falla a mitad de la reescritura del cuerpo de una página puede dejar
  tareas duplicadas hasta la corrida siguiente, que detecta el desajuste
  (por la propiedad "Huella") y repara la página completa.
- Las filas huérfanas (páginas de Notion cuyo slug ya no tiene documento) se
  informan en la salida, pero nunca se borran automáticamente.

## Licencia

MIT. Ver [`LICENSE`](LICENSE).
