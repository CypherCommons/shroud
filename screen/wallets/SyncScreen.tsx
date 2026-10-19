import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import ActionButton from '../../components/ActionButton';
import ProgressBar from '../../components/ProgressBar';
import SafeArea from '../../components/SafeArea';
import SyncStatusIcon, { PauseIcon, PlayIcon } from '../../components/SyncStatusIcon';
import ClockIcon from '../../components/icons/ClockIcon';
import InfoIcon from '../../components/icons/InfoIcon';
import RefreshIcon from '../../components/icons/RefreshIcon';
import { useScanState } from '../../hooks/context/useScanState';
import { useCheckFeedback, useCheckForPayments } from '../../hooks/useCheckForPayments';
import { useScanActions, useScannableWallet } from '../../hooks/useScannableWallet';
import { useSyncDisplayStatus } from '../../hooks/useSyncDisplayStatus';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';
import loc from '../../loc';
import { ClashFont } from '../../constants/fonts';
import { useTheme } from '../../components/themes';

type SyncScreenProps = NativeStackScreenProps<DetailViewStackParamList, 'SyncScreen'>;

function formatEtaAbout(ms: number | null): string | null {
  if (ms === null || ms <= 0) return null;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return loc.formatString(loc.sync.eta_about, { time: `${totalSeconds}s` });
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours >= 1) {
    const remainingMins = minutes % 60;
    const timeStr = remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
    return loc.formatString(loc.sync.eta_about, { time: timeStr });
  }
  return loc.formatString(loc.sync.eta_about, { time: `${minutes}m` });
}

/**
 * "about 2m left", counting down each second between the wallet's estimates (a batch apart, ~7s). Its
 * own component, so the countdown re-renders only itself.
 */
const EtaCountdown: React.FC<{ eta: number | null; etaComputedAt: number | null; running: boolean }> = ({
  eta,
  etaComputedAt,
  running,
}) => {
  const { colors } = useTheme();
  const [estimate, setEstimate] = useState({ eta, etaComputedAt });
  const [left, setLeft] = useState(eta);

  if (estimate.eta !== eta || estimate.etaComputedAt !== etaComputedAt) {
    setEstimate({ eta, etaComputedAt });
    setLeft(eta);
  }

  useEffect(() => {
    if (!running || eta === null || etaComputedAt === null) return;
    const id = setInterval(() => setLeft(Math.max(0, eta - (Date.now() - etaComputedAt))), 1000);
    return () => clearInterval(id);
  }, [running, eta, etaComputedAt]);

  return (
    <View style={styles.etaRow}>
      <ClockIcon size={18} color={colors.textMuted} />
      <Text style={[styles.etaText, { color: colors.textMuted }]}>{formatEtaAbout(left) ?? '--'}</Text>
    </View>
  );
};

/**
 * Fades a layout in as the screen moves to it, so a change of state reads as one rather than a jump.
 * Opacity, on the native driver: LayoutAnimation can't be relied on here, being off on Android by
 * default and dropped on iOS whenever something else commits first.
 */
const FadeIn: React.FC<{ animate: boolean; children: React.ReactNode }> = ({ animate, children }) => {
  const [opacity] = useState(() => new Animated.Value(animate ? 0 : 1));

  useEffect(() => {
    if (!animate) return;
    const animation = Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [animate, opacity]);

  return (
    <Animated.View style={[styles.layout, { opacity }]} testID="SyncLayout">
      {children}
    </Animated.View>
  );
};

const SyncScreen: React.FC<SyncScreenProps> = () => {
  const { colors } = useTheme();
  const scanState = useScanState();
  const wallet = useScannableWallet();
  const { pause, resume } = useScanActions(wallet);
  const { check, checking, outcome } = useCheckForPayments(wallet);
  const { status, settled } = useSyncDisplayStatus(scanState.status, checking);
  const landedOn = settled && !checking && (status === 'done' || status === 'error') ? status : null;
  const { feedback, pending } = useCheckFeedback(outcome, landedOn);
  // until the outcome is on screen too, so the button doesn't flash its idle title in between
  const busy = checking || pending;

  // The wallet goes idle, dropping its numbers, while the screen still holds a finished scan's layout
  // for its minimum time: keep showing that scan's last numbers.
  const live = scanState.status === 'scanning' || scanState.status === 'paused';
  const [lastLive, setLastLive] = useState(scanState);
  if (live && lastLive !== scanState) {
    setLastLive(scanState);
  }
  const scan = live ? scanState : lastLive;

  const inProgress = status === 'scanning' || status === 'paused';
  // Scanning and paused are one layout with different words, so only a move between layouts fades;
  // and not the one the screen opens on, which arrives with the screen.
  const layout = inProgress ? 'progress' : status;
  const [openedOn, setOpenedOn] = useState<string | null>(layout);
  if (openedOn !== null && layout !== openedOn) {
    setOpenedOn(null);
  }

  const percent = status === 'done' ? 100 : (scan.progress?.percentComplete ?? null);
  // A scan's first numbers come after its first window, so the bar sweeps until then rather than
  // reading 0%. A paused scan's bar stays still.
  const barProgress = percent !== null ? percent / 100 : status === 'paused' ? 0 : null;

  const title = { done: loc.sync.done, scanning: loc.sync.updating, paused: loc.sync.paused, error: loc.sync.error_title }[status];
  const feedbackText = feedback === 'checked' ? loc.sync.checked_just_now : feedback === 'failed' ? loc.sync.check_failed : null;
  const subtitle = inProgress
    ? loc.sync.subtitle_recent
    : busy
      ? loc.sync.subtitle_checking
      : (feedbackText ?? (status === 'done' ? loc.sync.subtitle_watching : loc.sync.error_description));

  // Android reads out the live regions' changes by itself; iOS has to be told.
  const announcedTitle = useRef(title);
  useEffect(() => {
    if (Platform.OS !== 'ios' || announcedTitle.current === title) return;
    announcedTitle.current = title;
    AccessibilityInfo.announceForAccessibilityWithOptions(title, { queue: true });
  }, [title]);
  useEffect(() => {
    if (Platform.OS === 'ios' && feedbackText !== null)
      AccessibilityInfo.announceForAccessibilityWithOptions(feedbackText, { queue: true });
  }, [feedbackText]);

  const renderActionButton = () => {
    switch (status) {
      case 'scanning':
        return (
          <ActionButton
            title={loc.sync.btn_pause}
            onPress={pause}
            Icon={PauseIcon}
            iconSize={13}
            backgroundColor={colors.brandPrimary}
            color={colors.white}
            style={styles.button}
            testID="SyncPauseButton"
          />
        );
      case 'paused':
        return (
          <ActionButton
            title={loc.sync.btn_continue}
            onPress={resume}
            Icon={PlayIcon}
            iconSize={17}
            backgroundColor={colors.brandPrimary}
            color={colors.white}
            style={styles.button}
            testID="SyncContinueButton"
          />
        );
      case 'done':
        return (
          <ActionButton
            title={busy ? loc.sync.btn_checking : loc.sync.btn_check_again}
            onPress={check}
            loading={busy}
            Icon={RefreshIcon}
            iconSize={20}
            backgroundColor={colors.accentSubtle}
            borderColor={colors.brandPrimary}
            color={colors.textBrand}
            iconColor={colors.brandPrimary}
            style={styles.button}
            testID="SyncCheckAgainButton"
          />
        );
      case 'error':
        return (
          <ActionButton
            title={busy ? loc.sync.btn_checking : loc.sync.btn_retry}
            onPress={check}
            loading={busy}
            Icon={RefreshIcon}
            iconSize={20}
            backgroundColor={colors.brandPrimary}
            color={colors.white}
            style={styles.button}
            testID="SyncRetryButton"
          />
        );
    }
  };

  return (
    <SafeArea>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} alwaysBounceVertical={false}>
        <FadeIn key={layout} animate={openedOn === null}>
          <View style={styles.iconBadge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <SyncStatusIcon status={status} size={66} />
          </View>

          <Text
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
            style={[styles.title, { color: status === 'error' ? colors.statusError : colors.textPrimary }]}
          >
            {title}
          </Text>

          {status !== 'error' && (
            // Kept at its height while there's no number yet, so the rows below don't move when one arrives.
            <View
              style={[styles.percentRow, percent === null && styles.hidden]}
              accessibilityElementsHidden={percent === null}
              importantForAccessibility={percent === null ? 'no-hide-descendants' : 'auto'}
              testID="SyncPercent"
            >
              <Text style={[styles.percentNum, { color: colors.textPrimary }]}>{Math.floor(percent ?? 0)}</Text>
              <Text style={[styles.percentSign, { color: colors.textMuted }]}>%</Text>
            </View>
          )}

          {inProgress && <EtaCountdown eta={scan.eta} etaComputedAt={scan.etaComputedAt} running={scanState.status === 'scanning'} />}

          {status !== 'error' && (
            <ProgressBar
              progress={barProgress}
              color={status === 'done' ? colors.statusSuccess : colors.brandPrimary}
              style={styles.bar}
              testID="SyncProgressBar"
            />
          )}

          <Text accessibilityLiveRegion="polite" style={[styles.subtitle, { color: colors.textMuted }]}>
            {subtitle}
          </Text>

          {inProgress && (
            <View style={[styles.progressCard, { backgroundColor: colors.surfaceSubtle, borderColor: colors.accentSubtle }]}>
              <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{loc.sync.update_progress}</Text>
              <View style={styles.cardRow}>
                <Text style={[styles.cardLabel, { color: colors.textMuted }]}>{loc.sync.block_label}</Text>
                {scan.progress ? (
                  <View style={styles.blockHeightRow}>
                    <Text style={[styles.cardValue, styles.cardValueSemibold, { color: colors.textPrimary }]} numberOfLines={1}>
                      {scan.progress.currentBlock.toLocaleString()}
                    </Text>
                    <Text style={[styles.cardValue, { color: colors.textMuted }]}>{' / '}</Text>
                    <Text style={[styles.cardValue, { color: colors.textPrimary }]} numberOfLines={1}>
                      {scan.progress.tipHeight.toLocaleString()}
                    </Text>
                  </View>
                ) : (
                  <Text style={[styles.cardValue, { color: colors.textPrimary }]} numberOfLines={1}>
                    --
                  </Text>
                )}
              </View>
            </View>
          )}

          {renderActionButton()}
        </FadeIn>

        <View style={[styles.privacyCard, { backgroundColor: colors.surfaceSubtle }]}>
          <InfoIcon size={20} color={colors.brandPrimary} />
          <Text style={[styles.privacyText, { color: colors.textMuted }]}>{loc.sync.privacy_info}</Text>
        </View>
      </ScrollView>
    </SafeArea>
  );
};

export default SyncScreen;

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 24,
    alignItems: 'center',
  },
  layout: {
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  iconBadge: {
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: 16,
    fontFamily: ClashFont.medium,
  },
  percentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  hidden: {
    opacity: 0,
  },
  percentNum: {
    fontSize: 44,
    lineHeight: 48,
    fontFamily: ClashFont.medium,
    letterSpacing: -2,
  },
  percentSign: {
    fontSize: 20,
    marginTop: 20,
    marginLeft: 2,
    fontFamily: ClashFont.medium,
  },
  etaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 8,
  },
  etaText: {
    fontSize: 13,
    fontFamily: ClashFont.regular,
  },
  bar: {
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
    fontFamily: ClashFont.regular,
  },
  progressCard: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 10,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    lineHeight: 24,
    marginBottom: 4,
    fontFamily: ClashFont.medium,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardLabel: {
    fontSize: 14,
    fontFamily: ClashFont.regular,
  },
  cardValue: {
    fontSize: 14,
    flexShrink: 1,
    textAlign: 'right',
    fontFamily: ClashFont.regular,
  },
  cardValueSemibold: {
    fontFamily: ClashFont.semibold,
  },
  blockHeightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  button: {
    alignSelf: 'stretch',
    marginBottom: 16,
  },
  privacyCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  privacyText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: ClashFont.regular,
  },
});
