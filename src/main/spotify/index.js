'use strict';

const servicios = require('../servicios');

/**
 * Spotify.
 *
 * Todo el comportamiento (cruzar con la biblioteca, contar lo que tienes,
 * una sincronizacion a la vez) esta en la fabrica de servicios/. Aqui solo
 * queda lo que es de Spotify y de nadie mas.
 */
module.exports = servicios.registrar({
  id: 'spotify',
  nombre: 'Spotify',
  auth: require('./auth'),
  catalogo: require('./catalogo'),
  cred: require('./credenciales'),
  ayuda: {
    nombreGuardadas: 'Tus me gusta',
    panel: 'https://developer.spotify.com/dashboard',
    panelTexto: 'developer.spotify.com/dashboard',
    // Spotify compara la URI de retorno caracter a caracter y hay que darla
    // de alta, asi que la interfaz la enseña para copiarla.
    redirectUri: require('./auth').REDIRECT_URI,
    pideSecreto: false,
    aviso: 'Desde febrero de 2026 la cuenta que registra la aplicacion necesita Spotify Premium.',
  },
});
