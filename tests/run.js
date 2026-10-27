// ==========================================
// run.js - Runs every engine test: `node tests/run.js` (add a number to change the fuzz game count)
// ==========================================

(async () => {
    const t0 = Date.now();
    let failed = await require('./mechanics.test.js')();
    failed += await require('./fuzz.test.js')(Number(process.argv[2]) || 1000);
    console.log((failed ? 'FAILED: ' + failed + ' test(s)' : 'All tests passed') + ' in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
    process.exitCode = failed ? 1 : 0;
})();
