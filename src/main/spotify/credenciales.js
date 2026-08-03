'use strict';

const { crearCredenciales } = require('../servicios/credenciales');

/**
 * Las credenciales de Spotify.
 *
 * Todo lo interesante esta en la fabrica: el token de refresco cifrado, el
 * de acceso solo en memoria, y por que esto no vive en settings.json.
 * Spotify no usa `clientSecret` — su flujo es PKCE puro.
 */
module.exports = crearCredenciales({ archivo: 'spotify.json', etiqueta: 'spotify' });
