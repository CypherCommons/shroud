/**
 * Crash reporting is native only: MainApplication.kt and AppDelegate.swift start Bugsnag at launch
 * unless crash reports are turned off in Settings → General (the `donottrack` preference). The
 * JavaScript Bugsnag client is deliberately never started: its plugins would attach console
 * messages and network request URLs, which can hold wallet details, to every report.
 * Fatal JavaScript errors are scrubbed before they reach native code (modules/crashRedaction.ts).
 */
const A = async (event: string) => {};

A.ENUM = {
  INIT: 'INIT',
  GOT_NONZERO_BALANCE: 'GOT_NONZERO_BALANCE',
  GOT_ZERO_BALANCE: 'GOT_ZERO_BALANCE',
  CREATED_WALLET: 'CREATED_WALLET',
  APP_UNSUSPENDED: 'APP_UNSUSPENDED',
};

export default A;
