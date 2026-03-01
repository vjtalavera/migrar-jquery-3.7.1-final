# Migrador Legacy a jQuery 3.7.1

Aplicación web profesional para detectar y corregir APIs **deprecated/removed** en proyectos legacy basados en jQuery.

## Qué hace

- Construye una base de conocimiento desde:
  - `https://api.jquery.com/category/deprecated/`
  - `https://api.jquery.com/category/removed/`
- Recorre URLs de entradas (`h1.entry-title a[href^="https://api.jquery.com/"]`) y extrae:
  - estado (`deprecated`, `removed`)
  - versiones (deprecado/removido en)
  - solución recomendada de migración
- Escanea solo archivos con extensión:
  - `.jsp`, `.js`, `.html`, `.htm`
- Detecta instrucciones jQuery que empiezan por:
  - `$jq`, `$`, `jQuery`
- Soporta múltiples instrucciones por línea.
- Incluye reglas explícitas de migración documentadas en API oficial para:
  - `$(document).ready(...)` y variantes legacy (deprecadas en 3.0, migrar a `$(handler)`).
  - `.attr('checked', ...)` sobre estado dinámico (migrar a `.prop('checked', ...)`).
- Modo fallback web opcional cuando no existe corrección clara en la API.

## Requisitos

- Node.js 20+ (recomendado 22+)

## Instalación

```bash
npm install
```

## Ejecución

```bash
npm run dev
```

Servidor: `http://localhost:4307`

## Rendimiento en VDI

El análisis se ejecuta con `worker_threads` para evitar bloquear el hilo principal del servidor.

Variables de entorno:

- `ANALYSIS_WORKERS`: número de workers de análisis (por defecto: `min(4, cpu-1)` y mínimo `1`).
- `ANALYSIS_QUEUE_LIMIT`: máximo de solicitudes en cola (por defecto: `48`).
- `REQUEST_BODY_LIMIT`: tamaño máximo del body JSON para subida (`/api/analyze/upload`), por defecto `80mb`.

Si la cola se llena, la API responde `503` para proteger estabilidad del servicio.

## Uso

1. Abre la interfaz web.
2. Pulsa **Actualizar desde API** para sincronizar conocimiento.
3. Analiza por:
   - rutas locales absolutas (archivos/carpetas), o
   - selección de archivos/carpeta en el navegador.
4. La aplicación prepara una sesión de archivos (sin analizar reglas todavía).
5. Selecciona un archivo en el listado para lanzar análisis de ese archivo + includes recursivos.
6. Revisa severidad, línea, API detectada y corrección propuesta.

Durante el análisis verás barra de progreso `0% -> 100%` en UI.  
Internamente la API usa ejecución asíncrona por `jobId`:

- `POST /api/analyze/paths` y `POST /api/analyze/upload` preparan sesión y devuelven `202` + `jobId`.
- `POST /api/analyze/session-file` analiza un archivo seleccionado y sus includes recursivos.
- `GET /api/analyze/jobs/:jobId` devuelve solo estado/progreso.
- `GET /api/analyze/jobs/:jobId/result` devuelve el resultado final cuando el job termina.

## Scripts

- `npm run dev`: inicia servidor.
- `npm run start`: inicia servidor.
- `npm run build:knowledge`: precarga/actualiza base de conocimiento local.
  - `npm run build:knowledge -- --no-force` (usar cache si existe)
  - `npm run build:knowledge -- --web-fallback`
- `npm test`: pruebas del motor.

## Estructura

- `src/server.js`: API y servidor web.
- `src/services/jquery-knowledge-service.js`: crawler + parser de API jQuery.
- `src/services/analyzer.js`: análisis de código legacy.
- `public/`: frontend (UI + reporte).
- `data/`: base de conocimiento cacheada.
