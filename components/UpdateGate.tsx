import React from 'react';

import { OtaUpdateScreen, UpdateRequiredScreen } from './UpdateScreens';
import { useOtaUpdate } from '../hooks/useOtaUpdate';
import { useUpdateRequired } from '../hooks/useUpdateRequired';

/**
 * Renders the app, or a blocking update screen in its place. Taking the navigator's place rather than
 * covering it keeps sheets and Modals from showing on top, and means a launch blocked by the saved
 * policy never mounts the unlock screen with its Face ID prompt.
 *
 * The trade-off: the screen takes over whenever a verdict arrives, not only before the app shows. The
 * launch never waits for the update check (fallbackToCacheTimeout is 0), so on a slow connection the
 * unlock prompt may already be up when a download starts, or a send half typed in when the first
 * policy answer lands (up to 10 s after a first launch). That screen and its form are lost, though not
 * the wallet; "Continue" mounts the app afresh.
 *
 * Wraps only the navigator: AppLock stays mounted outside, so a re-lock survives the screen coming and
 * going.
 */
const UpdateGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const updateRequired = useUpdateRequired();
  const ota = useOtaUpdate();

  // The saved policy hasn't been read yet.
  if (updateRequired === undefined) return null;
  // Comes first: an over-the-air update still downloads underneath and starts with the next launch.
  if (updateRequired) return <UpdateRequiredScreen />;
  if (ota.screen.kind !== 'hidden') {
    return <OtaUpdateScreen screen={ota.screen} onRestart={ota.restart} onRetry={ota.retry} onContinue={ota.dismiss} />;
  }
  return <>{children}</>;
};

export default UpdateGate;
