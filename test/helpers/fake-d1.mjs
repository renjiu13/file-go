import { DatabaseSync } from 'node:sqlite';
import { __resetSchemaCache } from '../../src/db/schema.js';

// 用 node:sqlite 模拟 D1 驱动的 prepare/bind/run/first/all/batch。
// db 是原生句柄，测试需要绕过 shim 直接查表时用它。
export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  const DB = {
    prepare(sql) {
      let args = [];
      return {
        bind(...a) { args = a; return this; },
        async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
        async first() { return db.prepare(sql).get(...args) ?? null; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async _auto() { return /^\s*(SELECT|WITH)/i.test(sql) ? this.all() : this.run(); },
      };
    },
    async batch(stmts) {
      const out = [];
      for (const s of stmts) out.push(await s._auto());
      return out;
    },
  };
  return { DB, db };
}

// 每次调用给一个全新的内存库，用例之间互不污染；db 供需要直接查表的断言使用。
// schema.js 的建表标记是模块级缓存，必须随新库一起重置。
export function fakeEnv(extra = {}) {
  __resetSchemaCache();
  const { DB, db } = fakeD1();
  return { env: Object.assign({ DB }, extra), db };
}
