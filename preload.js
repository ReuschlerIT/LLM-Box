'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const streams = new Map();
const jobs = new Map();
ipcRenderer.on('strata:event', (_e, msg) => {
  const cb = jobs.get(msg.id);
  if (!cb) return;
  if (msg.type === 'end' || msg.type === 'error') jobs.delete(msg.id);
  cb(msg);
});
ipcRenderer.on('llm:event', (_e, msg) => {
  const cb = streams.get(msg.id);
  if (!cb) return;
  if (msg.type === 'end' || msg.type === 'error') streams.delete(msg.id);
  cb(msg);
});

const inv = (ch, ...a) => ipcRenderer.invoke(ch, ...a);

// Live-Ausgabe laufender Programme (run_command / install_tool)
const execCbs = new Map();
ipcRenderer.on('sys:event', (_e, msg) => {
  const cb = execCbs.get(msg.id);
  if (cb) cb(msg);
});
const withLive = (ch) => (o, cb) => {
  if (cb && o && o.id) execCbs.set(o.id, cb);
  return inv(ch, o).finally(() => { if (o && o.id) execCbs.delete(o.id); });
};

contextBridge.exposeInMainWorld('api', {
  store: { get: (n) => inv('store:get', n), set: (n, d) => inv('store:set', n, d) },
  chats: {
    list: () => inv('chats:list'),
    load: (id) => inv('chats:load', id),
    save: (chat, meta) => inv('chats:save', chat, meta),
    delete: (id) => inv('chats:delete', id),
    deleteAll: () => inv('chats:deleteAll'),
    importPick: () => inv('chats:importPick'),
  },
  files: {
    pick: (mode, lim) => inv('files:pick', mode, lim),
    read: (paths, lim) => inv('files:read', paths, lim),
    pickFolder: (title) => inv('folder:pick', title),
    saveAs: (o) => inv('file:saveAs', o),
    pathOf: (file) => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return '';
      }
    },
  },
  cfg: { pick: () => inv('cfg:pick'), ctx: (f) => inv('cfg:ctx', f) },
  ws: {
    list: (o) => inv('ws:list', o),
    tool: (o) => inv('ws:tool', o),
    abortAll: () => inv('ws:abort'),
  },
  strata: {
    run: (req, cb) => {
      jobs.set(req.id, cb);
      return inv('strata:run', req);
    },
    abort: (id) => inv('sys:abort', id),
  },
  sys: {
    exec: withLive('sys:exec'),
    install: withLive('sys:install'),
    installCmd: (o) => inv('sys:installCmd', o),
    which: (o) => inv('sys:which', o),
    abort: (id) => inv('sys:abort', id),
  },
  fetch: (req) => inv('llm:fetch', req),
  stream: (req, cb) => {
    streams.set(req.id, cb);
    return inv('llm:stream', req);
  },
  abort: (id) => inv('llm:abort', id),
  openExternal: (u) => inv('shell:openExternal', u),
  openPath: (p) => inv('shell:openPath', p),
  appInfo: () => inv('app:info'),
  sync: { get: () => inv('sync:get'), setDir: (d) => inv('sync:setDir', d), migrate: () => inv('sync:migrate') },
  onChatsChanged: (cb) => ipcRenderer.on('chats:changed', (_e, m) => cb(m)),
  spellSet: (o) => inv('app:spellSet', o),
  gpuGet: () => inv('app:gpuGet'),
  gpuSet: (on) => inv('app:gpuSet', on),
  setWindowTheme: (o) => inv('win:theme', o),
  setWindowMaterial: (m) => inv('win:material', m),
});
