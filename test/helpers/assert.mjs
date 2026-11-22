// 轻量断言计数：跑完打印 pass/fail，有失败就以非零码退出。
// 不用测试框架，是为了让每个用例文件保持"从上到下读一遍就懂"的直白写法。
export function createAssert() {
  let pass = 0, fail = 0;

  function ok(cond, label) {
    if (cond) pass++;
    else { fail++; console.error('FAIL:', label); }
  }

  function eq(actual, expected, label) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) pass++;
    else { fail++; console.error(`FAIL: ${label}\n  actual   ${a}\n  expected ${e}`); }
  }

  function done() {
    console.log(`pass=${pass} fail=${fail}`);
    process.exit(fail ? 1 : 0);
  }

  return { ok, eq, done };
}
