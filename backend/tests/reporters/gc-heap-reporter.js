// Reliability Checkpoint 2B, Pass 2 — TEMPORARY diagnostic reporter.
// Fires once per completed suite: Jest's ReporterDispatcher calls onTestResult after that suite's
// natural --logHeapUsage sample has already been captured and stored on testResult, and — under
// --runInBand — before the next suite's environment is set up. Forces GC and logs a separately
// labeled reading so it can be compared against the natural --logHeapUsage numbers for the same
// suite without altering what --logHeapUsage itself reports. Delete once the diagnostic is done.
/* global global, console, process, module */
class GcHeapReporter {
  onTestResult(test, testResult) {
    const suite = testResult.testFilePath;
    if (typeof global.gc !== 'function') {
      console.log(`[gc-heap] ${suite}: global.gc unavailable — run with --expose-gc`);
      return;
    }
    global.gc();
    const heapUsedMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    console.log(`[gc-heap] ${suite}: ${heapUsedMB} MB heap size (forced GC)`);
  }
}

module.exports = GcHeapReporter;
