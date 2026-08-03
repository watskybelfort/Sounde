'use strict';

const servicios = require('../servicios');

/**
 * YouTube.
 *
 * No expone `redirectUri` porque Google admite cualquier puerto de bucle
 * local sin registrarlo: no hay nada que el usuario tenga que copiar, y
 * enseñarle una URI le haria buscar donde pegarla.
 */
module.exports = servicios.registrar({
  id: 'youtube',
  nombre: 'YouTube',
  auth: require('./auth'),
  catalogo: require('./catalogo'),
  cred: require('./credenciales'),
  ayuda: {
    panel: 'https://console.cloud.google.com/apis/credentials',
    panelTexto: 'console.cloud.google.com',
    redirectUri: null,
    pideSecreto: true,
    aviso: 'Es gratis y no pide tarjeta. Con el proyecto en modo de prueba, Google cierra la sesion cada siete dias y hay que volver a conectar.',
  },
});
