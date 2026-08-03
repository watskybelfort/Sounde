'use strict';

const { crearCredenciales } = require('../servicios/credenciales');

/**
 * Las credenciales de Google.
 *
 * A diferencia de Spotify, aqui `clientSecret` puede venir con valor: Google
 * lo entrega junto al Client ID para los clientes de escritorio. Es opcional
 * y no es un secreto de verdad — quien protege el intercambio es PKCE.
 */
module.exports = crearCredenciales({ archivo: 'youtube.json', etiqueta: 'youtube' });
