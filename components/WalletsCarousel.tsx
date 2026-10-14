import React, { useCallback, useMemo, useRef } from 'react';
import {
  Animated,
  ImageBackground,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  ViewStyle,
  UIManager,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import WalletGradient from '../class/wallet-gradient';
import { useSizeClass, SizeClass } from '../modules/sizeClass';
import loc, { formatBalance, transactionTimeToReadable } from '../loc';
import { BlurredBalanceView } from './BlurredBalanceView';
import { useTheme } from './themes';
import { useStorage } from '../hooks/context/useStorage';
import { useSettings } from '../hooks/context/useSettings';
import { WalletTransactionsStatus } from './Context/StorageProvider';
import { Transaction, TWallet } from '../class/wallets/types';
import { Spacing10 } from './Spacing';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface WalletCarouselItemProps {
  item: TWallet;
  onPress: (item: TWallet) => void;
  handleLongPress?: () => void;
  isSelectedWallet?: boolean;
  customStyle?: ViewStyle;
  horizontal?: boolean;
  onPressIn?: () => void;
  onPressOut?: () => void;
}

const iStyles = StyleSheet.create({
  root: { paddingRight: 20 },
  rootLargeDevice: { marginVertical: 20 },
  grad: {
    padding: 15,
    borderRadius: 12,
    minHeight: 164,
  },
  balanceContainer: {
    height: 40,
  },
  image: {
    width: 99,
    height: 94,
    position: 'absolute',
    bottom: 0,
    right: 0,
  },
  br: {
    backgroundColor: 'transparent',
  },
  label: {
    backgroundColor: 'transparent',
    fontSize: 19,
  },
  balance: {
    backgroundColor: 'transparent',
    fontWeight: 'bold',
    fontSize: 36,
  },
  latestTx: {
    backgroundColor: 'transparent',
    fontSize: 13,
  },
  latestTxTime: {
    backgroundColor: 'transparent',
    fontWeight: 'bold',
    fontSize: 16,
  },
  shadowContainer: {
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 25 / 100,
        shadowRadius: 8,
        borderRadius: 12,
      },
      android: {
        elevation: 8,
        borderRadius: 12,
      },
    }),
  },
});

export const WalletCarouselItem: React.FC<WalletCarouselItemProps> = React.memo(
  ({ item, onPress, handleLongPress, isSelectedWallet, customStyle, horizontal, onPressIn, onPressOut }: WalletCarouselItemProps) => {
    const scaleValue = useRef(new Animated.Value(1.0)).current;
    const { colors } = useTheme();
    const { walletTransactionUpdateStatus } = useStorage();
    const { isBalanceHidden } = useSettings();
    const { width } = useWindowDimensions();
    const itemWidth = width * 0.82 > 375 ? 375 : width * 0.82;
    const { sizeClass } = useSizeClass();

    const springConfig = useMemo(() => ({ useNativeDriver: true, tension: 100 }), []);
    const animateScale = useCallback(
      (toValue: number, callback?: () => void) => {
        Animated.spring(scaleValue, { toValue, ...springConfig }).start(callback);
      },
      [scaleValue, springConfig],
    );

    const onPressedIn = useCallback(() => {
      animateScale(0.95);
      if (onPressIn) onPressIn();
    }, [animateScale, onPressIn]);

    const onPressedOut = useCallback(() => {
      animateScale(1.0);
      if (onPressOut) onPressOut();
    }, [animateScale, onPressOut]);

    const handlePress = useCallback(() => {
      onPress(item);
    }, [item, onPress]);

    const image = require('../img/btc-shape.png');

    let latestTransactionText;

    if (walletTransactionUpdateStatus === WalletTransactionsStatus.ALL || walletTransactionUpdateStatus === item.getID()) {
      latestTransactionText = loc.transactions.updating;
    } else if (item.getBalance() !== 0 && item.getLatestTransactionTime() === 0) {
      latestTransactionText = loc.wallets.pull_to_refresh;
    } else if (item.getTransactions().find((tx: Transaction) => tx.confirmations === 0)) {
      latestTransactionText = loc.transactions.pending;
    } else {
      latestTransactionText = transactionTimeToReadable(item.getLatestTransactionTime());
    }

    const balance = !isBalanceHidden && formatBalance(Number(item.getBalance()), item.getPreferredBalanceUnit(), true);

    return (
      <Animated.View
        style={[
          sizeClass === SizeClass.Large || !horizontal
            ? [iStyles.rootLargeDevice, customStyle]
            : (customStyle ?? { ...iStyles.root, width: itemWidth }),
          {
            transform: [{ scale: scaleValue }],
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          testID={item.getLabel()}
          onPressIn={onPressedIn}
          onPressOut={onPressedOut}
          onLongPress={() => {
            if (handleLongPress) handleLongPress();
          }}
          onPress={handlePress}
          delayHoverIn={0}
          delayHoverOut={0}
        >
          <View style={[iStyles.shadowContainer, { backgroundColor: colors.background, shadowColor: colors.black }]}>
            <LinearGradient colors={WalletGradient.gradientsFor(item.type)} style={iStyles.grad}>
              <ImageBackground source={image} style={iStyles.image} />
              <Text style={iStyles.br} />
              <Text numberOfLines={1} style={[iStyles.label, { color: colors.white }]}>
                {item.getLabel()}
              </Text>
              <View style={iStyles.balanceContainer}>
                {isBalanceHidden ? (
                  <>
                    <Spacing10 />
                    <BlurredBalanceView />
                  </>
                ) : (
                  <Text numberOfLines={1} adjustsFontSizeToFit key={`${balance}`} style={[iStyles.balance, { color: colors.white }]}>
                    {`${balance} `}
                  </Text>
                )}
              </View>
              <Text style={iStyles.br} />
              <Text numberOfLines={1} style={[iStyles.latestTx, { color: colors.white }]}>
                {loc.wallets.list_latest_transaction}
              </Text>
              <Text numberOfLines={1} style={[iStyles.latestTxTime, { color: colors.white }]}>
                {latestTransactionText}
              </Text>
            </LinearGradient>
          </View>
        </Pressable>
      </Animated.View>
    );
  },
);
