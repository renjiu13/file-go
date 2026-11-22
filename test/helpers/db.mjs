// 把 src/db 的导出合成一个命名空间：测试正文有 130 多处 kv.xxx() 调用，
// 这样拆模块只影响 src 内部的依赖方向，用例文件不用跟着改写。
export * from '../../src/db/schema.js';
export * from '../../src/db/ids.js';
export * from '../../src/db/files.js';
export * from '../../src/db/dirs.js';
export * from '../../src/db/idem.js';
export * from '../../src/db/naming.js';
export * from '../../src/db/trash.js';
export * from '../../src/db/relocate.js';
export * from '../../src/db/batch.js';
