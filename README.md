# Lector de Manuales AI - Multimodal RAG

Esta aplicación permite interactuar con manuales técnicos en PDF (incluso en inglés) y obtener respuestas en español con evidencia visual directa del documento ("Source of Truth").

## Requisitos

- **Node.js** instalado.
- API Key de **Google AI Studio** (Gemini).
- API Key de **Pinecone** (Vector Database).

## Configuración

1. Asegúrate de que el archivo `.env` tenga tus claves:

```env
PINECONE_API_KEY=tu_clave
GOOGLE_AI_STUDIO_API_KEY=tu_clave
PINECONE_INDEX=manuals-reader
```

2. Coloca tus manuales en PDF en la carpeta `docs/`.

## Uso

### 1. Ingesta de Documentos

Para procesar los PDFs, extraer imágenes de las páginas, generar descripciones técnicas en español y vectorizarlos en Pinecone:

```bash
npm run ingest
```

### 2. Ejecutar la Aplicación

Para iniciar el servidor y la interfaz web:

```bash
node server.js
```

Luego abre [http://localhost:3000](http://localhost:3000) en tu navegador.

## Características

- **Multimodal**: Analiza tablas, diagramas y esquemas técnicos.
- **Traducción Automática**: Lee manuales en inglés pero responde y explica en español.
- **Fuente de Verdad**: Muestra la captura original de la página donde se encontró la respuesta.
