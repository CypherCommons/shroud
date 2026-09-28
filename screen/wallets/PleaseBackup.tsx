import { RouteProp, useFocusEffect, useRoute } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  InteractionManager,
} from 'react-native';
import { BlurView } from '@react-native-community/blur';
import { useSettings } from '../../hooks/context/useSettings';
import { useStorage } from '../../hooks/context/useStorage';
import { useScreenProtect } from '../../hooks/useScreenProtect';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation.ts';
import { AddWalletStackParamList } from '../../navigation/AddWalletStack';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import loc from '../../loc';
import presentAlert from '../../components/Alert';
import SeedVerification from '../../components/SeedVerification';
import { isE2E } from '../../helpers/e2e';
import { useTheme } from '../../components/themes';
import { ClashFont } from '../../constants/fonts';
import BackupStepHeader from '../../components/BackupStepHeader';
import Button from '../../components/Button';
import KeyIcon from '../../components/icons/KeyIcon';
import WritePaperIcon from '../../components/icons/WritePaperIcon';
import OfflineIcon from '../../components/icons/OfflineIcon';
import NoShareIcon from '../../components/icons/NoShareIcon';
import EyeIcon from '../../components/icons/EyeIcon';
import CameraOffIcon from '../../components/icons/CameraOffIcon';
import CheckboxUncheckedIcon from '../../components/icons/CheckboxUncheckedIcon';
import CheckboxCheckedIcon from '../../components/icons/CheckboxCheckedIcon';
import RevealEyeIcon from '../../components/icons/RevealEyeIcon';

type RouteProps = RouteProp<AddWalletStackParamList, 'PleaseBackup'>;

type Rect = { top: number; left: number; width: number; height: number };

enum BackupStep {
  INTRO = 'intro',
  SHOW_SEED = 'show-seed',
  VERIFY = 'verify',
}

const BACKUP_TIPS = [
  { Icon: WritePaperIcon, bold: loc.pleasebackup.tip_paper_bold, body: loc.pleasebackup.tip_paper_body },
  { Icon: OfflineIcon, bold: loc.pleasebackup.tip_offline_bold, body: loc.pleasebackup.tip_offline_body },
  { Icon: NoShareIcon, bold: loc.pleasebackup.tip_share_bold, body: loc.pleasebackup.tip_share_body },
];

const SKIP_VERIFY_TAP_THRESHOLD = 5;

// Android's blur reads much stronger than iOS per unit (different underlying implementations).
const GRID_BLUR_AMOUNT = Platform.select({ android: 8, default: 20 });

const PleaseBackup: React.FC = () => {
  const { wallets } = useStorage();
  const { walletID } = useRoute<RouteProps>().params;
  const wallet = wallets.find(w => w.getID() === walletID)!;
  const seedPhrase = wallet.getSecret();
  // Stable identity: SeedVerification re-shuffles whenever its `seed` prop identity changes, so a
  // fresh array on every PleaseBackup render (a wallets/settings/theme update while VERIFY is on
  // screen) would silently reshuffle mid-verification and desync the selection state from it.
  const seedWords = useMemo(() => seedPhrase.split(' '), [seedPhrase]);
  const navigation = useExtendedNavigation();
  const { colors } = useTheme();
  const { isScreenCaptureAllowed } = useSettings();
  const { enableScreenProtect, disableScreenProtect } = useScreenProtect();
  const [currentStep, setCurrentStep] = useState<BackupStep>(isE2E() ? BackupStep.SHOW_SEED : BackupStep.INTRO);
  const [isRevealed, setIsRevealed] = useState(false);
  const [hasConfirmedWritten, setHasConfirmedWritten] = useState(false);
  const [skipVerifyTaps, setSkipVerifyTaps] = useState(0);

  // BlurView's Android capture root is the whole Activity content view, not its own bounds
  // (hardcoded natively, not a prop) — rendered as a position-matched sibling overlay to keep the
  // blur visually scoped to the grid. Same capture-root issue means the reveal circle needs a
  // genuinely separate native window (Modal, below) — a same-window sibling still gets swept in.
  const [gridOverlayLayout, setGridOverlayLayout] = useState<Rect | null>(null);
  const [revealWindowLayout, setRevealWindowLayout] = useState<Rect | null>(null);
  const gridWrapperRef = useRef<View>(null);
  const insets = useSafeAreaInsets();

  const handleGridLayout = useCallback(() => {
    // measureInWindow gives screen-absolute coordinates. Retried via rAF on failure: the native
    // view can still be mid-creation when this runs, and measureInWindow then calls back with no
    // arguments at all (x/y come back undefined) — keeps retrying until the view actually exists.
    // Self-terminates on unmount, since the ref goes null and further calls become no-ops.
    const measure = () => {
      gridWrapperRef.current?.measureInWindow((x, y, width, height) => {
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
          requestAnimationFrame(measure);
          return;
        }
        setRevealWindowLayout({ left: x, top: y, width, height });
        // gridRevealOverlay renders inside stepRoot (not the Modal), so its position is relative
        // to stepRoot — which, as SafeAreaView's direct unpadded child, starts exactly at the
        // safe-area insets from the true screen origin (no native measurement needed for that).
        setGridOverlayLayout({ left: x - insets.left, top: y - insets.top, width, height });
      });
    };
    requestAnimationFrame(measure);
  }, [insets.left, insets.top]);

  // Modal's Dialog swallows all screen touches while visible (Android default), including the
  // header back button — this invisible same-position target restores it, using
  // BackupStepHeader's own fixed offsets (no ref/measurement needed — see insets above).
  // Window-absolute for the real Modal path (a genuinely separate window starting at the true
  // screen origin); under isE2E() these render as a plain sibling inside stepRoot instead (see
  // revealContent below), which already starts at the safe-area insets — so no insets offset there.
  const backButtonLayout: Rect = isE2E()
    ? { left: 24, top: 16, width: 32, height: 32 }
    : { left: insets.left + 24, top: insets.top + 16, width: 32, height: 32 };
  const revealLayout: Rect | null = revealWindowLayout
    ? isE2E()
      ? { ...revealWindowLayout, left: revealWindowLayout.left - insets.left, top: revealWindowLayout.top - insets.top }
      : revealWindowLayout
    : null;

  // Revealed: only the index box carries a fill — the word half is transparent, matching design.
  // rowBg is left undefined rather than pointed at a "transparent" token: RN drops an undefined
  // style value, which renders exactly as transparent without needing a color for "no color."
  const pillColors = isRevealed
    ? {
        rowBg: undefined,
        rowBorder: colors.revealedPillBorder,
        indexBg: colors.gridContainerBackground,
        indexBorder: colors.revealedPillBorder,
      }
    : {
        rowBg: colors.surfaceBrandSubtle,
        rowBorder: colors.borderDefault,
        indexBg: colors.fieldBackground,
        indexBorder: colors.borderDefault,
      };

  const handleVerifyComplete = useCallback(() => {
    InteractionManager.runAfterInteractions(() => {
      navigation.navigateToWalletsList();
    });
    return true;
  }, [navigation]);

  useEffect(() => {
    if (skipVerifyTaps >= SKIP_VERIFY_TAP_THRESHOLD) handleVerifyComplete();
  }, [skipVerifyTaps, handleVerifyComplete]);

  const handleProceedToVerification = () => {
    setCurrentStep(BackupStep.VERIFY);
  };

  const handleBackToSeed = () => {
    setCurrentStep(BackupStep.SHOW_SEED);
  };

  // The intro step is the only step with a working way off this screen (hardware back and swipe
  // are blocked below, specifically so a freshly-created, unbacked-up wallet can't be walked away
  // from by accident) — so leaving from here has to be a deliberate choice, not a bare goBack().
  const handleSkipBackup = () => {
    presentAlert({
      title: loc.pleasebackup.skip_title,
      message: loc.pleasebackup.skip_message,
      buttons: [
        { text: loc._.cancel, style: 'cancel' },
        { text: loc.pleasebackup.skip_confirm, style: 'destructive', onPress: () => navigation.goBack() },
      ],
      options: { cancelable: false },
    });
  };

  // Re-arms the "make sure no one is watching" gate: without this, leaving and returning to this
  // step shows the seed already revealed and the checkbox already checked from last time.
  const handleBackToIntro = () => {
    setCurrentStep(BackupStep.INTRO);
    setIsRevealed(false);
    setHasConfirmedWritten(false);
  };

  // Detox resolves element(by.id(...)) against the currently focused window only. Wrapping this
  // in a real Modal (below) — necessary in production to keep BlurView from capturing it — makes
  // the Modal's Dialog take window focus, which makes everything in the main window (including
  // PleaseBackupScrollView and SkipVerifyBackdoor) unreachable to e2e tests. No current e2e spec
  // exercises this reveal interaction directly (all bypass via SkipVerifyBackdoor), so rendering
  // it as a plain sibling under isE2E() costs no real coverage.
  const revealContent = revealLayout && (
    <View style={styles.modalRoot} pointerEvents="box-none">
      <TouchableOpacity style={[styles.backButtonGhost, backButtonLayout]} onPress={handleBackToIntro} testID="RevealBackButtonGhost" />
      <TouchableOpacity style={[styles.revealOverlay, revealLayout]} onPress={() => setIsRevealed(true)} testID="RevealSeedPhrase">
        <View style={[styles.revealCircle, { backgroundColor: colors.revealCircleBackground }]}>
          <RevealEyeIcon size={64} color={colors.white} />
        </View>
        <Text style={[styles.revealTitle, { color: colors.textPrimary }]}>{loc.pleasebackup.tap_to_reveal}</Text>
        <Text style={[styles.revealCaption, { color: colors.textMuted }]}>{loc.pleasebackup.tap_to_reveal_caption}</Text>
      </TouchableOpacity>
    </View>
  );

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);

    return () => {
      subscription.remove();
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!isScreenCaptureAllowed) enableScreenProtect();
      return () => {
        disableScreenProtect();
      };
    }, [disableScreenProtect, enableScreenProtect, isScreenCaptureAllowed]),
  );

  return (
    <>
      <SafeAreaView style={styles.safeArea}>
        {currentStep === BackupStep.INTRO && (
          <View style={styles.stepRoot}>
            <BackupStepHeader onBack={handleSkipBackup} filledSteps={1} totalSteps={3} testID="BackupIntroBackButton" />

            <ScrollView contentContainerStyle={styles.introScrollContent}>
              <View style={[styles.iconBadge, { backgroundColor: colors.surfaceSubtle, borderColor: colors.accentSubtle }]}>
                <KeyIcon size={64} color={colors.brandPrimary} />
              </View>
              <Text style={[styles.introTitle, { color: colors.textPrimary }]}>{loc.pleasebackup.intro_title}</Text>
              <Text style={[styles.introSubtitle, { color: colors.textMuted }]}>{loc.pleasebackup.intro_subtitle}</Text>

              {BACKUP_TIPS.map(tip => (
                <View key={tip.bold} style={[styles.tipCard, { borderColor: colors.accentSubtle }]}>
                  <View style={styles.tipIconBadge}>
                    <tip.Icon size={20} color={colors.tipIconColor} />
                  </View>
                  <Text style={styles.tipText}>
                    <Text style={[styles.tipBold, { color: colors.textPrimary }]}>{tip.bold}</Text>
                    <Text style={[styles.tipBody, { color: colors.textSecondary }]}>{tip.body}</Text>
                  </Text>
                </View>
              ))}
            </ScrollView>

            <View style={styles.footer}>
              <Button
                title={loc.pleasebackup.view_recovery_phrase}
                onPress={() => setCurrentStep(BackupStep.SHOW_SEED)}
                testID="ViewRecoveryPhrase"
                borderRadius={16}
                icon={<EyeIcon color={colors.white} />}
                style={styles.footerButton}
              />
            </View>
          </View>
        )}

        {currentStep === BackupStep.SHOW_SEED && (
          <View style={styles.stepRoot}>
            <BackupStepHeader onBack={handleBackToIntro} filledSteps={2} totalSteps={3} testID="RevealBackButton" />

            <ScrollView
              contentContainerStyle={styles.revealScrollContent}
              onScroll={handleGridLayout}
              scrollEventThrottle={16}
              testID="PleaseBackupScrollView"
            >
              <Text style={[styles.title, { color: colors.textPrimary }]}>{loc.pleasebackup.title}</Text>
              <Text style={[styles.subtitle, { color: colors.textMuted }]}>{loc.pleasebackup.text}</Text>

              <View style={[styles.warningBanner, { backgroundColor: colors.surfaceSubtle, borderColor: colors.accentSubtle }]}>
                <CameraOffIcon size={20} color={colors.brandPrimary} />
                <Text style={styles.warningText}>
                  <Text style={{ color: colors.warningBannerPrefixText }}>{loc.pleasebackup.screenshot_warning_prefix}</Text>
                  <Text style={[styles.warningEmphasis, { color: colors.textBrand }]}>{loc.pleasebackup.screenshot_warning_emphasis}</Text>
                </Text>
              </View>

              <View
                style={[styles.wordGridWrapper, !isRevealed && { backgroundColor: colors.gridContainerBackground }]}
                onLayout={handleGridLayout}
                ref={gridWrapperRef}
              >
                <View style={styles.wordsGrid}>
                  {seedWords.map((word, idx) => (
                    <View key={idx} style={[styles.seedRowShadow, { shadowColor: colors.black }]}>
                      <View style={[styles.seedRow, { backgroundColor: pillColors.rowBg, borderColor: pillColors.rowBorder }]}>
                        <View style={[styles.seedIndexBox, { backgroundColor: pillColors.indexBg, borderColor: pillColors.indexBorder }]}>
                          <Text style={[styles.seedIndexText, { color: colors.textMuted }]}>{idx + 1}</Text>
                        </View>
                        <View style={styles.seedWordBox}>
                          {isRevealed ? (
                            <Text style={[styles.seedWordText, { color: colors.textPrimary }]}>{word}</Text>
                          ) : (
                            // Solid bar, not real text: glyphs are too thin for the blur to hold a visible shape.
                            <View style={[styles.seedWordPlaceholder, { backgroundColor: colors.textPrimary }]} />
                          )}
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              </View>

              <TouchableOpacity
                style={styles.checkboxRow}
                onPress={() => setHasConfirmedWritten(c => !c)}
                testID="ConfirmWrittenDown"
                activeOpacity={0.7}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: hasConfirmedWritten }}
              >
                {hasConfirmedWritten ? (
                  <CheckboxCheckedIcon size={20} color={colors.brandPrimary} />
                ) : (
                  <CheckboxUncheckedIcon size={20} color={colors.checkboxUncheckedColor} />
                )}
                <Text style={[styles.checkboxText, { color: colors.textPrimary }]}>{loc.pleasebackup.confirm_written_down}</Text>
              </TouchableOpacity>
            </ScrollView>

            {!isRevealed && gridOverlayLayout && (
              <View style={[styles.gridRevealOverlay, gridOverlayLayout]} pointerEvents="box-none">
                <BlurView
                  style={styles.gridBlur}
                  // 'dark' produces a glow/bloom artifact around foreground content that 'light'
                  // doesn't — forced regardless of theme; gridScrimBackground below handles the
                  // actual light/dark tint instead.
                  blurType="light"
                  overlayColor="transparent"
                  blurAmount={GRID_BLUR_AMOUNT}
                  reducedTransparencyFallbackColor={colors.fieldBackground}
                  autoUpdate={false}
                />
                <View style={[styles.gridScrim, { backgroundColor: colors.gridScrimBackground }]} pointerEvents="none" />
              </View>
            )}

            {/* onRequestClose mirrors the header's back handler — the Modal's Dialog intercepts
                the hardware back key natively before BackHandler would see it. */}
            {!isRevealed &&
              revealContent &&
              (isE2E() ? (
                revealContent
              ) : (
                <Modal transparent statusBarTranslucent animationType="none" onRequestClose={handleBackToIntro}>
                  {revealContent}
                </Modal>
              ))}

            <View style={styles.footer}>
              <Button
                title={loc.pleasebackup.continue}
                onPress={handleProceedToVerification}
                testID="ContinueToVerify"
                borderRadius={16}
                disabled={!hasConfirmedWritten}
                disabledBackgroundColor={colors.backupContinueDisabledBackground}
                // Button's default disabled text (alternativeTextColor) is ~identical to this
                // background in light mode and ~1:1 contrast in dark — colors.black is the only
                // token here that clears 4.5:1 against both backupContinueDisabledBackground shades.
                disabledTextColor={colors.black}
                style={styles.footerButton}
              />
            </View>

            {isE2E() && (
              <TouchableWithoutFeedback
                onPress={() => setSkipVerifyTaps(c => c + 1)}
                accessible={false}
                importantForAccessibility="no-hide-descendants"
                testID="SkipVerifyBackdoor"
              >
                <View style={styles.skipVerifyBackdoor} />
              </TouchableWithoutFeedback>
            )}
          </View>
        )}

        {currentStep === BackupStep.VERIFY && (
          <SeedVerification seed={seedWords} onSuccess={handleVerifyComplete} onBack={handleBackToSeed} />
        )}
      </SafeAreaView>
    </>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  stepRoot: {
    flex: 1,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  footerButton: { height: 56, maxHeight: 56 },
  introScrollContent: {
    paddingHorizontal: 24,
  },
  iconBadge: {
    width: 64,
    height: 64,
    borderRadius: 20,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  introTitle: { fontFamily: ClashFont.medium, fontSize: 32, lineHeight: 40, letterSpacing: -1.2, marginBottom: 12 },
  introSubtitle: { fontFamily: ClashFont.regular, fontSize: 15, lineHeight: 22.5, marginBottom: 24 },
  tipCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: 16,
    padding: 17,
    gap: 12,
    marginBottom: 16,
  },
  tipIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tipText: { flex: 1, fontSize: 14, lineHeight: 20 },
  tipBold: { fontFamily: ClashFont.medium },
  tipBody: { fontFamily: ClashFont.regular },
  revealScrollContent: {
    paddingHorizontal: 24,
  },
  title: { fontFamily: ClashFont.medium, fontSize: 32, lineHeight: 40, letterSpacing: -1.2, marginBottom: 12 },
  subtitle: { fontFamily: ClashFont.regular, fontSize: 15, lineHeight: 22.5, marginBottom: 20 },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 20,
  },
  warningText: { flex: 1, fontFamily: ClashFont.regular, fontSize: 14, lineHeight: 20 },
  warningEmphasis: { fontFamily: ClashFont.medium },
  wordGridWrapper: {
    marginBottom: 20,
    borderRadius: 20,
    overflow: 'hidden',
  },
  wordsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 13,
  },
  // Outer shadow wrapper + inner clipped view: iOS clips shadows on a view with overflow:hidden.
  seedRowShadow: {
    width: '48%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 1.5,
    elevation: 2,
  },
  seedRow: {
    flexDirection: 'row',
    width: '100%',
    height: 43,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  seedIndexBox: {
    width: 47,
    borderRightWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  seedIndexText: { fontFamily: ClashFont.medium, fontSize: 13 },
  seedWordBox: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  seedWordText: { fontFamily: ClashFont.medium, fontSize: 15 },
  // Lower opacity, not a lighter color: keeps the solid-bar shape the blur needs while matching
  // the design's subtler post-blur contrast.
  seedWordPlaceholder: {
    width: '70%',
    height: 10,
    borderRadius: 5,
    opacity: 0.35,
  },
  // Positioned/sized in JS to match the grid's on-screen rect — rendered outside the ScrollView so
  // BlurView's blur source doesn't tint the rest of the scrollable content.
  gridRevealOverlay: {
    position: 'absolute',
    borderRadius: 20,
    overflow: 'hidden',
  },
  gridBlur: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  gridScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  // absoluteFill, not flex: 1: in production this is the sole child of <Modal> so both are
  // equivalent, but under isE2E() (no Modal) a flex:1 sibling renders wherever normal flow puts
  // it — after the ScrollView, near the footer — while its children still assume this box starts
  // at stepRoot's own origin (see backButtonLayout/revealLayout above). absoluteFill pins it there.
  modalRoot: {
    ...StyleSheet.absoluteFill,
  },
  backButtonGhost: {
    position: 'absolute',
  },
  // top/left/width/height come from revealWindowLayout — no static fill here.
  revealOverlay: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  revealCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  revealTitle: { fontFamily: ClashFont.semibold, fontSize: 16, marginBottom: 6 },
  revealCaption: { fontFamily: ClashFont.regular, fontSize: 13 },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 4,
  },
  checkboxText: { flex: 1, fontFamily: ClashFont.regular, fontSize: 15, lineHeight: 22.5 },
  skipVerifyBackdoor: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
});

export default PleaseBackup;
