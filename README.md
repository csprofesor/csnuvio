# CSNuvio

Nuvio plugin repository for testing and development.

## Structure

- `manifest.json` — Nuvio plugin repository manifest
- `providers/` — JavaScript providers executed by Nuvio's QuickJS runtime

## Test provider

`providers/test.js` returns a public HLS test stream. This is only a runtime test; it does not scrape a movie or TV site.

## Manifest URL

`https://raw.githubusercontent.com/csprofesor/csnuvio/main/manifest.json`
