import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Icon } from '@rneui/themed';
import ChevronRightIcon from './icons/ChevronRightIcon';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import loc from '../loc';
import { DetailViewStackParamList } from '../navigation/DetailViewStackParamList';
import { useTheme } from './themes';
import { useScanState } from '../hooks/context/useScanState';
import { ClashFont } from '../constants/fonts';

interface Props {
  onResume: () => void;
  onRetry: () => void;
}

type NavigationProps = NativeStackNavigationProp<DetailViewStackParamList>;

// Reads the scan's state itself, so a progress report re-renders this banner rather than the home screen.
const ScanProgressBar: React.FC<Props> = ({ onResume, onRetry }) => {
  const { colors } = useTheme();
  const scanState = useScanState();
  const navigation = useNavigation<NavigationProps>();
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  const { status, progress, lastScannedBlock } = scanState;

  useEffect(() => {
    if (status === 'scanning') {
      pulseAnimRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.35, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ]),
      );
      pulseAnimRef.current.start();
    } else {
      pulseAnimRef.current?.stop();
      pulseAnim.setValue(1);
    }
    return () => pulseAnimRef.current?.stop();
  }, [status, pulseAnim]);

  const isDone = status === 'idle' && lastScannedBlock > 0;
  if (status === 'idle' && !isDone) return null;

  if (isDone) {
    const blockText = loc.formatString(loc.sync.banner_synced, { blockHeight: lastScannedBlock.toLocaleString() });
    return (
      <TouchableOpacity
        style={[styles.container, { borderColor: colors.accentSubtle, backgroundColor: colors.surfaceSubtle }]}
        onPress={() => navigation.navigate('SyncScreen')}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={blockText as string}
      >
        <View style={styles.leftRow}>
          <View style={styles.glyphBox}>
            <Icon name="check" type="material" size={20} color={colors.statusSuccess} />
          </View>
          <Text style={[styles.bannerText, { color: colors.textSecondary }]} numberOfLines={1}>
            {blockText}
          </Text>
        </View>
        <ChevronRightIcon color={colors.iconSecondary} />
      </TouchableOpacity>
    );
  }

  if (status === 'paused') {
    const pausedBlock = progress?.currentBlock ?? lastScannedBlock;
    const blockText = loc.formatString(loc.sync.banner_paused_at, { blockHeight: pausedBlock.toLocaleString() });
    return (
      <View style={[styles.container, { borderColor: colors.accentSubtle, backgroundColor: colors.surfaceSubtle }]}>
        <TouchableOpacity
          style={styles.leftRow}
          onPress={() => navigation.navigate('SyncScreen')}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={blockText as string}
        >
          <View style={styles.glyphBox}>
            <Icon name="pause" type="material" size={20} color={colors.textMuted} />
          </View>
          <Text style={[styles.bannerText, { color: colors.textSecondary }]} numberOfLines={1}>
            {blockText}
          </Text>
        </TouchableOpacity>
        <Pressable onPress={onResume} hitSlop={8} accessibilityRole="button" accessibilityLabel={loc.sync.banner_resume}>
          <Text style={[styles.actionText, { color: colors.textBrand }]}>{loc.sync.banner_resume}</Text>
        </Pressable>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={[styles.container, { borderColor: colors.statusError, backgroundColor: colors.surfaceCaution }]}>
        <TouchableOpacity
          style={styles.leftRow}
          onPress={() => navigation.navigate('SyncScreen')}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={loc.sync.banner_error}
        >
          <View style={styles.glyphBox}>
            <Icon name="info-outline" type="material" size={20} color={colors.statusError} />
          </View>
          <Text style={[styles.bannerText, { color: colors.statusError }]} numberOfLines={1}>
            {loc.sync.banner_error}
          </Text>
        </TouchableOpacity>
        <Pressable onPress={onRetry} hitSlop={8} accessibilityRole="button" accessibilityLabel={loc.sync.btn_retry}>
          <Text style={[styles.actionText, { color: colors.statusError }]}>{loc.sync.btn_retry}</Text>
        </Pressable>
      </View>
    );
  }

  const dotColor = colors.brandPrimary;
  const bannerText = loc.sync.banner_scanning;

  return (
    <TouchableOpacity
      style={[styles.container, { borderColor: colors.accentSubtle, backgroundColor: colors.surfaceSubtle }]}
      onPress={() => navigation.navigate('SyncScreen')}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={bannerText}
    >
      <View style={styles.leftRow}>
        <View style={styles.glyphBox}>
          <View style={[styles.halo, { backgroundColor: dotColor }]} />
          <Animated.View style={[styles.dot, { backgroundColor: dotColor, opacity: pulseAnim }]} />
        </View>
        <Text style={[styles.bannerText, { color: colors.textSecondary }]} numberOfLines={1}>
          {bannerText}
        </Text>
      </View>
      <Icon name="chevron-right" type="material" size={20} color={colors.iconSecondary} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 16,
    height: 50,
    paddingLeft: 16,
    paddingRight: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  // One geometry for all four states: 16 (container) + 32 (glyphBox) + 4 puts the label at 52,
  // the left edge the design specifies. Per-state boxes made the glyph jump between renders.
  leftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  glyphBox: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    opacity: 0.2,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  bannerText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: ClashFont.regular,
    flex: 1,
  },
  actionText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: ClashFont.medium,
  },
});

export default ScanProgressBar;
