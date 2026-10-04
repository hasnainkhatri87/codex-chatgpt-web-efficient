// Unit-test shim only: no browser is launched and no Electron behavior is simulated.
const Module = require('node:module');
const original = Module._load;
Module._load = function(id, ...args) {
  if (id === 'electron') return {};
  return original.call(this, id, ...args);
};
