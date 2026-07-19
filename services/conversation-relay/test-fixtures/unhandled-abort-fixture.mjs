/**
 * Child-process fixture for gemini-stream-safety.test.js.
 *
 * Reproduces the production crash structurally: an UNCAUGHT rejecting promise
 * (the SDK's teed result.response branch on abort), with the process-level
 * safety net installed. If the net works, the process must survive and exit 0
 * rather than exit(1) the way it did in prod.
 *
 * Usage: node unhandled-abort-fixture.mjs <abort|unexpected>
 * Prints "SURVIVED" to stdout iff the process did not crash on the rejection.
 */
import { installProcessSafetyNet } from '../gemini-stream-safety.js';

installProcessSafetyNet();

const kind = process.argv[2];

// Mimic the exact shape the SDK produces. On abort it is the GENERIC error
// (name is not "AbortError"); the "unexpected" case is an unrelated failure.
const reason =
  kind === 'abort'
    ? Object.assign(new Error('Request aborted when reading from the stream'), {
        name: 'GoogleGenerativeAIAbortError',
      })
    : new Error('some genuinely unexpected failure');

// Intentionally NOT caught — this is what server.js's teed result.response did.
Promise.reject(reason);

// Give the microtask + a macrotask time to fire an unhandledRejection. If the
// safety net did not keep us alive, the process would have exited before this.
setTimeout(() => {
  console.log('SURVIVED');
  process.exit(0);
}, 50);
