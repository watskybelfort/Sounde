'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Almacen JSON con escritura diferida y atomica.
 *
 * Escribe a un temporal y renombra encima. Si se escribiera directo, un
 * cierre a destiempo deja el archivo a medias y al siguiente arranque la
 * app pierde toda la configuracion sin decir nada.
 */
class JsonStore {
  constructor(file, defaults = {}) {
    this.file = file;
    this.defaults = defaults;
    this.data = { ...defaults };
    this._timer = null;
    this.load();
  }

  load() {
    try {
      // El BOM se quita antes de parsear: JSON.parse lo trata como basura y
      // lanza. Cualquier editor de Windows lo pone sin avisar, y el sintoma
      // seria que el usuario edita ajustes.json a mano y la app arranca como
      // si el archivo no existiera, con todo por defecto.
      const raw = fs.readFileSync(this.file, 'utf8').replace(/^﻿/, '');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') this.data = { ...this.defaults, ...parsed };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('[store] no pude leer', this.file, '-', err.message);
      }
      this.data = { ...this.defaults };
    }
    return this.data;
  }

  get(key, fallback) {
    const v = this.data[key];
    return v === undefined ? fallback : v;
  }

  set(key, value) {
    this.data[key] = value;
    this.schedule();
  }

  merge(patch) {
    Object.assign(this.data, patch);
    this.schedule();
  }

  all() {
    return { ...this.data };
  }

  schedule() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this.save(), 300);
  }

  save() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    const tmp = `${this.file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[store] no se pudo guardar', this.file, err.message);
      try { fs.unlinkSync(tmp); } catch { /* ya no estaba */ }
    }
  }
}

module.exports = { JsonStore };
